import { crearProveedores } from '@/channels/factory'
import type { ChannelProvider } from '@/channels/provider'
import { canalDelIntento } from '@/channels/provider'
import type { CategoriaFacturable } from '@/channels/tarifas'
import { categoriaDelEnvio } from '@/channels/ventana-servicio'
import { planificarEnvio } from '@/cadence/planificador'
import { registrarContacto } from '@/repo/cobranza/contactos'
import { abrirOReutilizar } from '@/repo/cobranza/conversaciones'
import {
  cadenciaDelTramo,
  cargarContexto,
  marcarPasoEjecutado,
  pasosEjecutados,
} from '@/repo/cobranza/contexto'
import { ventanaDe } from '@/repo/cobranza/ventanas'
import type { Db } from '@/repo/db'
import { credencialesWhatsApp } from '@/repo/tenants'

/**
 * El encendido del motor.
 *
 * `pasosVencidos`, `planificarEnvio` y `evaluar` estaban escritos y probados
 * desde hace semanas y no los llamaba nada. Esto los conecta: es lo que separa
 * una bandeja de un agente que cobra solo.
 *
 * Las **tres ramas escriben un `Contacto`**, incluida la que no envía. Eso no es
 * simetría por prolijidad: la cotización vende "historial de cada intento,
 * incluidos los bloqueados por política", y ante un reclamo ante la SIC lo que
 * prueba que la empresa cumplió no es el mensaje que salió, es el que **no**
 * salió y por qué.
 */

export type ResultadoPaso =
  | { tipo: 'enviado'; contactoId: string; costoCop: number }
  | { tipo: 'reprogramado'; instante: string; motivo: string }
  | { tipo: 'detenido'; motivo: string }
  | { tipo: 'omitido'; motivo: string }

export async function ejecutarPaso(
  db: Db,
  tenantId: string,
  params: {
    obligacionId: string
    indice: number
    ahora: Date
    proveedores?: Record<'whatsapp' | 'sms', ChannelProvider>
  },
): Promise<ResultadoPaso> {
  const contexto = await cargarContexto(db, tenantId, params.obligacionId)
  if (!contexto) return { tipo: 'omitido', motivo: 'obligación inexistente' }

  const cadencia = await cadenciaDelTramo(db, tenantId, contexto.obligacion.tramo)
  if (!cadencia || !cadencia.activa) {
    return { tipo: 'omitido', motivo: `sin cadencia activa para el tramo ${contexto.obligacion.tramo}` }
  }

  const paso = cadencia.pasos[params.indice]
  if (!paso) return { tipo: 'omitido', motivo: `el paso ${params.indice} no existe` }

  // El UNIQUE decide antes de gastar nada: si otra corrida del cron ya lo tomó,
  // esta se retira sin enviar. Es lo que impide el mensaje duplicado cuando dos
  // ejecuciones se pisan.
  if (!(await marcarPasoEjecutado(db, tenantId, params.obligacionId, params.indice))) {
    return { tipo: 'omitido', motivo: 'otro proceso ya ejecutó este paso' }
  }

  const { id: conversacionId } = await abrirOReutilizar(db, tenantId, {
    deudorId: contexto.deudor.id,
    obligacionId: params.obligacionId,
    ahora: params.ahora.toISOString(),
  })

  const escribir = (
    resultado: Parameters<typeof registrarContacto>[2]['resultado'],
    datos: {
      canal: 'whatsapp' | 'sms'
      cuerpo: string
      motivoBloqueo?: string | null
      costoCop?: number
      idProveedor?: string | null
      proveedor?: string | null
      /**
       * Con qué se factura. Se calculaba dieciocho líneas más abajo, se le
       * entregaba al proveedor para que cobrara, y no se guardaba: todo contacto
       * de cadencia entraba con `categoria` en NULL.
       *
       * La cadencia es justo la que manda el grueso de las plantillas
       * facturables, así que el desglose de la pantalla de Consumo salía vacío
       * debajo de un total que no era cero, y el cupo de plantillas no se movía
       * nunca — o sea que el excedente vendido no se facturaba jamás.
       */
      categoria?: CategoriaFacturable | null
    },
  ) =>
    registrarContacto(db, tenantId, {
      obligacionId: params.obligacionId,
      deudorId: contexto.deudor.id,
      conversacionId,
      canal: datos.canal,
      direccion: 'saliente',
      timestamp: params.ahora.toISOString(),
      plantillaId: null,
      cuerpo: datos.cuerpo,
      resultado,
      motivoBloqueo: datos.motivoBloqueo ?? null,
      costoCop: datos.costoCop ?? 0,
      categoria: datos.categoria ?? null,
      idProveedor: datos.idProveedor ?? null,
      proveedor: datos.proveedor ?? null,
    })

  const plan = planificarEnvio(
    {
      canal: paso.canal,
      deudor: contexto.deudor,
      obligacion: contexto.obligacion,
      contactosDelDeudor: contexto.contactosDelDeudor,
    },
    params.ahora,
  )

  if (plan.tipo === 'detener') {
    await escribir('bloqueado', {
      canal: paso.canal,
      cuerpo: '',
      motivoBloqueo: `${plan.motivo}: ${plan.detalle}`,
    })
    return { tipo: 'detenido', motivo: plan.motivo }
  }

  if (plan.tipo === 'reprogramar') {
    // También se escribe un contacto bloqueado: el hueco en la conversación
    // tiene que tener explicación. Sin esto, el asesor ve tres días de silencio
    // y no sabe si el sistema falló o si la ley lo impidió.
    await escribir('bloqueado', {
      canal: paso.canal,
      cuerpo: '',
      // Se registra el motivo INICIAL, no el de espera: la auditoría pregunta
      // por qué no se contactó ese día, no por qué se eligió el siguiente.
      motivoBloqueo: `${plan.motivoInicial}: reprogramado para ${plan.instante.toISOString()}`,
    })
    return { tipo: 'reprogramado', instante: plan.instante.toISOString(), motivo: plan.motivoDeEspera }
  }

  const canal = canalDelIntento(paso.canal, false, paso.fallbackSms ?? false)
  if (!canal) return { tipo: 'omitido', motivo: 'sin canal disponible' }

  const ventana = await ventanaDe(db, tenantId, contexto.deudor.id)
  const categoria = categoriaDelEnvio({
    ventana,
    ahora: params.ahora,
    // Un paso de cadencia sale por plantilla: es un mensaje que inicia la
    // empresa, así que Meta lo cobra por su categoría.
    categoriaDePlantilla: 'utility',
  })

  // Mismo motivo que en `responder.ts`: el número que ve el deudor es el de su
  // acreedor, no el que quedó en las variables del despliegue.
  const proveedores =
    params.proveedores ?? crearProveedores({ tenant: await credencialesWhatsApp(db, tenantId) })
  const cuerpo = `Recordatorio del crédito ${contexto.obligacion.numeroCredito}.`
  const enviado = await proveedores[canal].enviar({
    para: contexto.deudor.telefonos[0] ?? '',
    canal,
    plantilla: { nombre: `paso_${params.indice}`, variables: [] },
    cuerpo,
    categoria,
  })

  const { id } = await escribir(enviado.estado, {
    canal,
    cuerpo,
    motivoBloqueo: enviado.ok ? null : (enviado.error ?? 'fallo de envío'),
    costoCop: enviado.costoCop,
    // Un intento que no salió no se factura, así que tampoco tiene categoría.
    categoria: enviado.estado === 'fallido' ? null : categoria,
    idProveedor: enviado.idProveedor,
    proveedor: proveedores[canal].nombre,
  })

  return { tipo: 'enviado', contactoId: id, costoCop: enviado.costoCop }
}

/** Los pasos que hoy corresponden, por obligación. Es lo que el cron encola. */
export async function pasosPendientes(
  db: Db,
  tenantId: string,
  hoy: string,
): Promise<Array<{ obligacionId: string; indice: number }>> {
  const obligaciones = await db.query<{ id: string; tramo: string }>(
    `SELECT id, tramo FROM obligaciones
      WHERE tenant_id = $1 AND estado IN ('en_mora', 'al_dia')`,
    [tenantId],
  )

  const salida: Array<{ obligacionId: string; indice: number }> = []

  for (const o of obligaciones) {
    const cadencia = await cadenciaDelTramo(db, tenantId, o.tramo as never)
    if (!cadencia?.activa) continue

    const contexto = await cargarContexto(db, tenantId, o.id)
    if (!contexto) continue

    const ejecutados = await pasosEjecutados(db, tenantId, o.id)
    const { pasosVencidos } = await import('@/cadence/planificador')

    for (const p of pasosVencidos(contexto.obligacion, cadencia, hoy, ejecutados)) {
      salida.push({ obligacionId: o.id, indice: p.indice })
    }
  }

  return salida
}
