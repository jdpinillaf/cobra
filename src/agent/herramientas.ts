import { tool } from 'ai'
import { z } from 'zod'
import type { Acuerdo, LimitesNegociacion, Pago } from '@/domain/types'
import { construirReferencia } from '@/payments/wompi'
import { sumarDias } from '@/compliance/reloj-bogota'
import { buscarPoliticas } from './politicas'
import type { PuertoAgente } from './puerto'

/**
 * Las herramientas del agente.
 *
 * Cada una hace dos cosas: devolverle algo al modelo, y dejar un rastro visible
 * en `conversacion.traza`. El rastro no es decorativo — es lo que permite
 * mostrarle al cliente *qué consultó* el agente antes de responder, que es la
 * diferencia entre esto y un chatbot.
 *
 * Las validaciones viven acá, no en el prompt. Un prompt que dice "no ofrezcas
 * más de 4 cuotas" es una sugerencia; `proponerAcuerdo` rechazando 6 cuotas es
 * un candado. Los dos existen a propósito: el prompt para que el agente no lo
 * intente, la validación para cuando lo intente igual.
 */

export interface ContextoHerramientas {
  /**
   * De dónde salen los datos y a dónde van las escrituras.
   *
   * Antes acá venía el `EstadoDemo` entero, y las herramientas lo mutaban. Eso
   * ataba las seis —las que aplican los límites de negociación— a que la
   * conversación viviera en memoria del proceso, o sea a la demo de la landing.
   */
  puerto: PuertoAgente
  limites: LimitesNegociacion
  /** `YYYY-MM-DD` en Bogotá. */
  fechaHoy: string
  /** Origen público, para armar el link de pago. */
  urlBase: string
  /**
   * Por dónde está hablando. Default `whatsapp`: ningún llamador existente
   * cambia.
   *
   * Solo cambia lo que la herramienta le **dice al agente que diga**. Por
   * teléfono, «le responde por este mismo chat» es falso —la persona está en
   * una llamada— y suena a plantilla mal pegada, que es exactamente lo que un
   * cliente escucha cuando duda de que esto sea real.
   */
  canal?: 'whatsapp' | 'voz'
}

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

/**
 * Registra un acuerdo si cabe en los límites.
 *
 * Está afuera de la definición de la herramienta para que el respaldo sin modelo
 * (`guionado.ts`) pueda usar exactamente la misma validación y dejar el mismo
 * rastro. Si el respaldo tuviera su propia lógica, sería el único camino del
 * sistema que nadie valida — y es justo el que corre cuando algo ya salió mal.
 */
export async function registrarAcuerdo(
  ctx: ContextoHerramientas,
  entrada: {
    tipo: Acuerdo['tipo']
    montoAcordado: number
    numeroCuotas: number
    descuentoPct: number
    primeraCuotaEl: string
  },
): Promise<{ aceptado: true; porCuota: number } | { aceptado: false; motivo: string }> {
  const { puerto, limites, fechaHoy } = ctx
  const { obligacion } = puerto

  const rechazo = validarAcuerdo(entrada, limites, fechaHoy)
  if (rechazo) {
    await puerto.anotarPaso({
      herramienta: 'proponerAcuerdo',
      detalle: `Rechazado: ${rechazo}`,
      estado: 'bloqueado',
    })
    return { aceptado: false, motivo: rechazo }
  }

  const ahora = new Date().toISOString()
  const acuerdo: Acuerdo = {
    id: puerto.nuevoId('acu'),
    clienteId: obligacion.clienteId,
    obligacionId: obligacion.id,
    tipo: entrada.tipo,
    montoAcordado: entrada.montoAcordado,
    descuentoPct: entrada.descuentoPct,
    numeroCuotas: entrada.numeroCuotas,
    primeraCuotaEl: entrada.primeraCuotaEl,
    /**
     * El modelo de dominio exige que un humano apruebe cada acuerdo
     * (`types.ts:183`). Acá queda `aprobado` porque el humano ya aprobó *el
     * rango*: si pasó la validación, está adentro de lo que el cliente autorizó
     * por escrito. Lo que sale del rango sigue yendo a una persona. Si un
     * cliente quiere aprobación caso a caso, se cambia este estado a
     * `esperando_aprobacion` y el agente espera.
     */
    estado: 'aprobado',
    propuestoEn: ahora,
    aprobadoPor: 'política preaprobada',
    aprobadoEn: ahora,
    motivoRechazo: null,
  }
  await puerto.guardarAcuerdo(acuerdo)

  const porCuota = Math.round(entrada.montoAcordado / entrada.numeroCuotas)
  await puerto.anotarPaso({
    herramienta: 'proponerAcuerdo',
    detalle: `${entrada.numeroCuotas} × ${cop(porCuota)} desde el ${entrada.primeraCuotaEl}${entrada.descuentoPct ? ` · ${entrada.descuentoPct}% dto.` : ''}`,
    estado: 'ok',
  })

  return { aceptado: true, porCuota }
}

/** Crea el cobro y devuelve la URL. Mismo motivo que `registrarAcuerdo` para estar suelta. */
export async function emitirLinkDePago(
  ctx: ContextoHerramientas,
  montoCop: number,
): Promise<{ url: string; referencia: string }> {
  const { puerto, urlBase } = ctx
  const { obligacion } = puerto

  const referencia = construirReferencia(obligacion.id, puerto.nonce())
  const pago: Pago = {
    id: puerto.nuevoId('pag'),
    clienteId: obligacion.clienteId,
    obligacionId: obligacion.id,
    referencia,
    monto: montoCop,
    pasarela: 'wompi',
    transaccionId: null,
    estado: 'pendiente',
    creadoEn: new Date().toISOString(),
    pagadoEn: null,
    atribuidoAlAgente: false,
  }
  await puerto.guardarPago(pago)

  await puerto.anotarPaso({
    herramienta: 'generarLinkDePago',
    detalle: `${cop(montoCop)} · referencia ${referencia}`,
    estado: 'ok',
  })

  return { url: `${dominioDePagos(urlBase)}/pagar/${referencia}`, referencia }
}

/**
 * Dónde vive el link que ve el deudor.
 *
 * En producción es el dominio del cliente. Para grabar sirve poner uno creíble
 * en `URL_PUBLICA_PAGOS`: un `localhost:3100` en el chat delata que es una
 * demo local y distrae de lo que se está mostrando.
 */
function dominioDePagos(urlBase: string): string {
  return (process.env.URL_PUBLICA_PAGOS ?? urlBase).replace(/\/$/, '')
}

export function crearHerramientas(ctx: ContextoHerramientas) {
  const { puerto } = ctx
  const { obligacion, deudor } = puerto
  const porDondeResponde =
    ctx.canal === 'voz' ? 'le escribe por WhatsApp a este mismo número' : 'le responde por este mismo chat'

  const paso = (herramienta: string, detalle: string, estadoPaso: 'ok' | 'bloqueado' = 'ok') =>
    puerto.anotarPaso({ herramienta, detalle, estado: estadoPaso })

  return {
    consultarCartera: tool({
      description:
        'Trae el expediente del deudor: saldo, días de mora, número de crédito, qué se le ha dicho antes y qué prometió. Llámala antes de mencionar cualquier cifra.',
      inputSchema: z.object({
        motivo: z
          .string()
          .describe('Por qué necesitas el expediente. Una frase corta, para el registro.'),
      }),
      execute: async ({ motivo }) => {
        const salientes = puerto.contactosPrevios.filter((c) => c.direccion === 'saliente')

        // El motivo entra en el rastro para que cada consulta se distinga de la
        // anterior: cuatro líneas idénticas son ruido, cuatro líneas que dicen
        // para qué se consultó son el argumento de venta.
        await paso(
          'consultarCartera',
          `${obligacion.numeroCredito} · ${cop(obligacion.saldoTotal)} · ${obligacion.diasMora} días — ${motivo}`,
        )

        return {
          encontrado: true as const,
          motivo,
          nombre: deudor.nombre,
          numeroCredito: obligacion.numeroCredito,
          capital: obligacion.capital,
          interesMora: obligacion.interesMora,
          saldoTotal: obligacion.saldoTotal,
          saldoLegible: cop(obligacion.saldoTotal),
          diasMora: obligacion.diasMora,
          tramo: obligacion.tramo,
          fechaVencimiento: obligacion.fechaVencimiento,
          estadoObligacion: obligacion.estado,
          contactosPrevios: salientes.length,
          ultimoContacto: salientes.at(-1)?.timestamp ?? null,
          acuerdoVigente: puerto.acuerdoVigente
            ? {
                cuotas: puerto.acuerdoVigente.numeroCuotas,
                monto: puerto.acuerdoVigente.montoAcordado,
                estado: puerto.acuerdoVigente.estado,
              }
            : null,
        }
      },
    }),

    consultarPoliticas: tool({
      description:
        'Consulta las políticas de la empresa: medios de pago, cómo se manejan las disputas, reporte a centrales, qué hacer si el deudor está en una situación difícil. Úsala cuando la situación tenga una regla y no estés seguro.',
      inputSchema: z.object({
        consulta: z
          .string()
          .describe('Qué necesitas saber, en las palabras del deudor si es posible.'),
      }),
      execute: async ({ consulta }) => {
        const encontradas = buscarPoliticas(consulta)
        await paso(
          'consultarPoliticas',
          encontradas.length
            ? encontradas.map((p) => p.titulo).join(' · ')
            : `Sin política para «${consulta}»`,
        )
        return {
          politicas: encontradas.map((p) => ({ titulo: p.titulo, contenido: p.contenido })),
        }
      },
    }),

    proponerAcuerdo: tool({
      description:
        'Valida un acuerdo de pago contra los límites que autorizó la empresa. Llámala ANTES de proponerle nada al deudor. Si la rechaza, escala a un humano en vez de insistir.',
      inputSchema: z.object({
        tipo: z.enum(['pago_total', 'pago_parcial', 'cuotas', 'descuento']),
        montoAcordado: z
          .number()
          .int()
          .positive()
          .describe('Total que va a pagar el deudor, en pesos, ya con el descuento aplicado.'),
        numeroCuotas: z.number().int().min(1).describe('En cuántas cuotas se parte.'),
        descuentoPct: z.number().min(0).max(100).default(0),
        primeraCuotaEl: z
          .string()
          .describe('Fecha de la primera cuota o del pago único, formato YYYY-MM-DD.'),
      }),
      execute: async (entrada) => {
        const resultado = await registrarAcuerdo(ctx, entrada)
        if (!resultado.aceptado) {
          return {
            aceptado: false as const,
            motivo: resultado.motivo,
            queHacer:
              'Está fuera de lo que la empresa autorizó. Llama a escalarAHumano y dile al deudor que un asesor lo revisa y le responde.',
          }
        }

        return {
          aceptado: true as const,
          montoPorCuota: resultado.porCuota,
          montoPorCuotaLegible: cop(resultado.porCuota),
          totalLegible: cop(entrada.montoAcordado),
          queHacer:
            'Propónselo al deudor en concreto, con montos y fechas. Espera que confirme antes de generar el link.',
        }
      },
    }),

    generarLinkDePago: tool({
      description:
        'Genera el link de pago. Solo después de que el deudor haya aceptado un monto concreto.',
      inputSchema: z.object({
        montoCop: z.number().int().positive().describe('Cuánto va a pagar ahora, en pesos.'),
        concepto: z
          .string()
          .describe('Qué está pagando, en una línea. Ej: «primera cuota del acuerdo».'),
      }),
      execute: async ({ montoCop, concepto }) => {
        const link = await emitirLinkDePago(ctx, montoCop)

        return {
          generado: true as const,
          url: link.url,
          referencia: link.referencia,
          montoLegible: cop(montoCop),
          concepto,
          queHacer: 'Mándale el link en el mensaje, con el monto exacto. No repitas la referencia.',
        }
      },
    }),

    escalarAHumano: tool({
      description:
        'Pasa el caso a una persona del equipo de cobranza, con la conversación completa. Úsala cuando el deudor pide algo fuera de los límites, reclama que no debe, o la situación no la cubre ninguna política.',
      inputSchema: z.object({
        motivo: z.enum([
          'fuera_de_limites',
          'disputa_la_deuda',
          'situacion_especial',
          'deudor_alterado',
          'no_cubierto_por_politica',
        ]),
        resumen: z.string().describe('Qué necesita el asesor para retomar. Dos o tres frases.'),
      }),
      execute: async ({ motivo, resumen }) => {
        await puerto.tomaUnHumano()
        await paso('escalarAHumano', `${motivo.replace(/_/g, ' ')} — ${resumen}`)
        return {
          escalado: true as const,
          queHacer: `Dile al deudor, sin prometer plazos concretos, que un asesor va a revisar su caso y ${porDondeResponde}. No le des una respuesta tú.`,
        }
      },
    }),

    marcarNumeroErrado: tool({
      description:
        'Marca el número como equivocado y cierra la conversación. Úsala apenas alguien diga que no es el titular.',
      inputSchema: z.object({
        loQueDijo: z.string().describe('La frase textual con la que lo dijo, para el registro.'),
      }),
      execute: async ({ loQueDijo }) => {
        await puerto.marcarNumeroErrado(new Date().toISOString())
        await paso('marcarNumeroErrado', `«${loQueDijo}» — número marcado, gestión detenida`)
        return {
          marcado: true as const,
          queHacer:
            'Pide disculpas por la molestia y despídete. NO menciones el monto, ni el número del crédito, ni el nombre del titular.',
        }
      },
    }),
  }
}

/**
 * Devuelve el motivo del rechazo, o `null` si el acuerdo cabe.
 *
 * El orden importa poco, pero el mensaje sí: se lo lee el modelo y de ahí sale
 * lo que escala. Un "no se puede" pelado haría que improvisara una explicación.
 */
function validarAcuerdo(
  entrada: {
    montoAcordado: number
    numeroCuotas: number
    descuentoPct: number
    primeraCuotaEl: string
  },
  limites: LimitesNegociacion,
  fechaHoy: string,
): string | null {
  if (entrada.numeroCuotas > limites.cuotasMax) {
    return `Pidió ${entrada.numeroCuotas} cuotas y la empresa autoriza hasta ${limites.cuotasMax}.`
  }
  if (entrada.descuentoPct > limites.descuentoMaxPct) {
    return `Pidió ${entrada.descuentoPct}% de descuento y la empresa autoriza hasta ${limites.descuentoMaxPct}%.`
  }

  const limiteFecha = sumarDias(fechaHoy, limites.diasPlazoMax)
  if (entrada.primeraCuotaEl > limiteFecha) {
    return `La primera cuota quedaría el ${entrada.primeraCuotaEl} y el plazo máximo autorizado llega hasta el ${limiteFecha}.`
  }

  const porCuota = Math.round(entrada.montoAcordado / entrada.numeroCuotas)
  if (porCuota < limites.montoMinimoAbono) {
    return `Cada cuota quedaría en ${cop(porCuota)} y el abono mínimo autorizado es ${cop(limites.montoMinimoAbono)}.`
  }

  return null
}
