import type { Cadencia, CanalContacto, Contacto, Deudor, Obligacion, PasoCadencia, TramoMora } from '@/domain/types'
import { evaluar, type Decision, type MotivoBloqueo, type SolicitudEnvio } from '@/compliance/guard'
import { desdeBogota, enBogota, sumarDias } from '@/compliance/reloj-bogota'

/**
 * Planificador de cadencia.
 *
 * Decide **qué** paso toca y **cuándo** puede salir legalmente. Es una función
 * pura sobre un instante: la demo la corre con un reloj acelerado y producción
 * la corre desde un workflow durable, sin cambiar una línea.
 *
 * La separación con el guard es deliberada: el guard responde "¿puedo enviar
 * ahora?", el planificador responde "¿cuándo es el próximo momento en que sí?".
 */

/** Deriva el tramo de mora. El ancla siempre es la fecha de vencimiento. */
export function calcularTramo(diasMora: number): TramoMora {
  if (diasMora <= 0) return 'preventiva'
  if (diasMora <= 30) return 'temprana'
  if (diasMora <= 90) return 'media'
  if (diasMora <= 180) return 'tardia'
  return 'castigada'
}

export interface PasoProgramado {
  indice: number
  paso: PasoCadencia
  /** Fecha en que el paso queda habilitado, `YYYY-MM-DD` en Bogotá. */
  fechaObjetivo: string
}

/**
 * Pasos de la cadencia cuya fecha objetivo ya llegó y que no se han ejecutado.
 *
 * Los offsets se cuentan desde `fechaVencimiento`, lo que unifica preventiva
 * (offsets negativos) y mora (offsets positivos) en una sola escala.
 */
export function pasosVencidos(
  obligacion: Obligacion,
  cadencia: Cadencia,
  hoy: string,
  indicesEjecutados: ReadonlySet<number>,
): PasoProgramado[] {
  if (!cadencia.activa) return []

  return cadencia.pasos
    .map((paso, indice) => ({
      indice,
      paso,
      fechaObjetivo: sumarDias(obligacion.fechaVencimiento, paso.offsetDias),
    }))
    .filter((p) => !indicesEjecutados.has(p.indice) && p.fechaObjetivo <= hoy)
}

/**
 * Motivos que ninguna espera resuelve. Si el guard devuelve uno de estos, no
 * tiene sentido buscar otra ventana: la cadencia de este deudor se detiene.
 */
const MOTIVOS_DEFINITIVOS: ReadonlySet<MotivoBloqueo> = new Set([
  'destinatario_es_referencia',
  'opt_out',
  'sin_consentimiento',
  'obligacion_cerrada',
  'acuerdo_vigente',
  'canal_distinto_al_preferido',
])

export type ResultadoPlanificacion =
  | { tipo: 'enviar_ahora'; instante: Date }
  | {
      tipo: 'reprogramar'
      instante: Date
      /** El último motivo antes de encontrar ventana: explica la fecha nueva. */
      motivoDeEspera: MotivoBloqueo
      /**
       * Por qué no se pudo **ahora**. Es el que va al registro de cumplimiento:
       * la pregunta que responde una auditoría es "por qué no contactaron ese
       * día", no "por qué eligieron el día siguiente". Pueden diferir — un
       * domingo seguido de un festivo deja `domingo` acá y `festivo` arriba.
       */
      motivoInicial: MotivoBloqueo
    }
  | { tipo: 'detener'; motivo: MotivoBloqueo; detalle: string }

/**
 * Primer instante a partir de `desde` en que el guard autorizaría el envío.
 *
 * Explora día por día probando el inicio de la ventana permitida de cada uno.
 * Probar el inicio basta: si el arranque de la ventana está bloqueado por
 * frecuencia o por calendario, el resto del día lo está igual; y si está
 * bloqueado por horario preferido, el inicio efectivo ya lo incorpora.
 */
export function planificarEnvio(
  base: Omit<SolicitudEnvio, 'ahora'>,
  desde: Date,
  maxDias = 21,
): ResultadoPlanificacion {
  const inmediato = evaluar({ ...base, ahora: desde })
  if (inmediato.permitido) return { tipo: 'enviar_ahora', instante: desde }

  const definitivo = decisionDefinitiva(inmediato)
  if (definitivo) return definitivo

  const t0 = enBogota(desde)
  let ultimoMotivo: MotivoBloqueo = inmediato.motivo

  for (let salto = 0; salto <= maxDias; salto++) {
    const fecha = sumarDias(t0.fecha, salto)
    const candidato = inicioDeVentana(fecha, base.deudor)
    if (!candidato) continue
    // El primer día solo cuenta si su ventana aún no pasó.
    if (candidato.getTime() < desde.getTime()) continue

    const decision = evaluar({ ...base, ahora: candidato })
    if (decision.permitido) {
      return {
        tipo: 'reprogramar',
        instante: candidato,
        motivoDeEspera: ultimoMotivo,
        motivoInicial: inmediato.motivo,
      }
    }
    const corte = decisionDefinitiva(decision)
    if (corte) return corte
    ultimoMotivo = decision.motivo
  }

  return {
    tipo: 'detener',
    motivo: ultimoMotivo,
    detalle: `No se encontró ventana permitida en los próximos ${maxDias} días.`,
  }
}

function decisionDefinitiva(decision: Decision): ResultadoPlanificacion | null {
  if (decision.permitido) return null
  if (!MOTIVOS_DEFINITIVOS.has(decision.motivo)) return null
  return { tipo: 'detener', motivo: decision.motivo, detalle: decision.detalle }
}

/**
 * Primer instante contactable de una fecha, ya cruzando la ventana legal con la
 * preferencia del deudor. Devuelve `null` si ese día no es contactable.
 */
function inicioDeVentana(fecha: string, deudor: Deudor): Date | null {
  const diaSemana = new Date(`${fecha}T00:00:00Z`).getUTCDay()
  if (diaSemana === 0) return null

  const legalDesde = diaSemana === 6 ? 8 : 7
  const legalHasta = diaSemana === 6 ? 15 : 19

  const pref = deudor.preferencia
  const desde = Math.max(legalDesde, pref.horaDesde ?? legalDesde)
  const hasta = Math.min(legalHasta, pref.horaHasta ?? legalHasta)
  if (desde >= hasta) return null

  return desdeBogota(fecha, desde)
}

/**
 * Consumo del cupo del cliente. Cuenta entrantes y salientes.
 *
 * El costo sale de `Contacto.costoCop`, que ya viene resuelto por el proveedor
 * que lo envió. No se re-deriva aquí de una tabla: con Meta directo el precio
 * depende de la categoría de la plantilla y un mensaje dentro de la ventana de
 * servicio de 24 h vale cero, así que una constante por canal daría un número
 * equivocado.
 *
 * Que el conteo incluya entrantes es una decisión comercial, no un reflejo del
 * costo: con Meta el tráfico conversacional es gratis y ese cupo es margen.
 */
export function consumoDelPeriodo(contactos: Contacto[]): {
  mensajes: number
  llamadas: number
  costoCop: number
  porCanal: Record<CanalContacto, number>
} {
  const cuentan = contactos.filter((c) => c.resultado !== 'bloqueado')
  const porCanal: Record<CanalContacto, number> = { whatsapp: 0, sms: 0, voz: 0 }
  let costoCop = 0
  for (const c of cuentan) {
    porCanal[c.canal] += 1
    costoCop += c.costoCop
  }
  /**
   * La voz se cuenta aparte y **no** suma a `mensajes`.
   *
   * No es prolijidad: `mensajes` es lo que se descuenta de `mensajesIncluidos`
   * del plan, y una llamada cuesta ~300 veces un WhatsApp. Meterla en el mismo
   * cupo dejaría a un cliente gastando su plan entero en veinte llamadas, y a
   * nosotros cobrando COP 45 por algo que nos costó COP 772.
   */
  const llamadas = porCanal.voz
  return { mensajes: cuentan.length - llamadas, llamadas, costoCop, porCanal }
}
