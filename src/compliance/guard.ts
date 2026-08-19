import type { Canal, Contacto, Deudor, Obligacion } from '@/domain/types'
import { esFestivo } from './festivos'
import { enBogota, type InstanteBogota } from './reloj-bogota'

/**
 * Guard de compliance de la Ley 2300 de 2023.
 *
 * Ningún mensaje sale del sistema sin pasar por aquí. La función es pura: recibe
 * el estado y devuelve una decisión con motivo. Eso la hace testeable con reloj
 * congelado y hace que el log de decisiones sea reproducible — que es
 * exactamente lo que se necesita frente a un requerimiento de la SIC.
 */

export type MotivoBloqueo =
  | 'destinatario_es_referencia'
  | 'opt_out'
  | 'sin_consentimiento'
  | 'obligacion_cerrada'
  | 'acuerdo_vigente'
  | 'domingo'
  | 'festivo'
  | 'fuera_de_horario_legal'
  | 'canal_distinto_al_preferido'
  | 'fuera_de_horario_preferido'
  | 'dia_distinto_al_preferido'
  | 'limite_diario'
  | 'limite_semanal'

export type Decision =
  | { permitido: true; evaluadoEn: InstanteBogota }
  | { permitido: false; motivo: MotivoBloqueo; detalle: string; evaluadoEn: InstanteBogota }

export interface SolicitudEnvio {
  ahora: Date
  canal: Canal
  deudor: Deudor
  obligacion: Obligacion
  /**
   * Historial de contactos **del deudor**, no solo de esta obligación.
   *
   * La Ley 2300 protege la tranquilidad de la persona, no de cada crédito por
   * separado: un deudor con tres préstamos no puede recibir tres mensajes en la
   * misma semana. Es la lectura conservadora y es la que deja al cliente a
   * salvo de sanción.
   */
  contactosDelDeudor: Contacto[]
}

/**
 * Ventana legal de contacto en Colombia. Índice = día de la semana (0 domingo).
 * `null` significa que ese día no se puede contactar en absoluto.
 */
const VENTANA_LEGAL: ReadonlyArray<{ desde: number; hasta: number } | null> = [
  null, // domingo — prohibido
  { desde: 7 * 60, hasta: 19 * 60 }, // lunes
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 }, // viernes
  { desde: 8 * 60, hasta: 15 * 60 }, // sábado
]

/**
 * Estados de envío que consumen cupo de contacto.
 *
 * Un intento `bloqueado` nunca llegó al deudor, así que no gasta su cuota
 * semanal — si contara, un bloqueo por horario impediría reintentar al día
 * siguiente. Un `fallido` tampoco llegó. `encolado` sí cuenta: está a punto de
 * salir y contarlo evita la carrera de dos envíos simultáneos.
 */
const CONSUMEN_CUPO = new Set(['encolado', 'enviado', 'entregado', 'leido'])

const UN_DIA_MS = 86_400_000

function contactosQueCuentan(contactos: Contacto[]): Contacto[] {
  return contactos.filter((c) => c.direccion === 'saliente' && CONSUMEN_CUPO.has(c.resultado))
}

export function evaluar(solicitud: SolicitudEnvio): Decision {
  const { ahora, canal, deudor, obligacion } = solicitud
  const t = enBogota(ahora)
  const bloquear = (motivo: MotivoBloqueo, detalle: string): Decision => ({
    permitido: false,
    motivo,
    detalle,
    evaluadoEn: t,
  })

  // --- Prohibiciones absolutas: ni el horario ni la cadencia las levantan ---

  if (deudor.rol === 'referencia') {
    return bloquear(
      'destinatario_es_referencia',
      'La Ley 2300 solo permite contactar al deudor, codeudor o deudor solidario.',
    )
  }

  if (deudor.consentimiento.revocadoEn !== null) {
    return bloquear(
      'opt_out',
      `El deudor revocó la autorización de contacto el ${deudor.consentimiento.revocadoEn}.`,
    )
  }

  if (!deudor.consentimiento.otorgado) {
    return bloquear(
      'sin_consentimiento',
      'No hay autorización de contacto registrada para este deudor.',
    )
  }

  // --- Estado de la obligación: no se persigue lo que ya está resuelto ---

  if (obligacion.estado === 'pagada') {
    return bloquear('obligacion_cerrada', 'La obligación ya fue pagada.')
  }

  if (obligacion.estado === 'juridico') {
    return bloquear(
      'obligacion_cerrada',
      'La obligación pasó a cobro jurídico; la gestión sale del agente.',
    )
  }

  if (obligacion.estado === 'acuerdo_vigente') {
    return bloquear(
      'acuerdo_vigente',
      'Hay un acuerdo de pago vigente; presionar sobre un acuerdo cumplido es hostigamiento.',
    )
  }

  // --- Ventana temporal legal ---

  if (t.diaSemana === 0) {
    return bloquear('domingo', 'Prohibido el contacto de cobranza los domingos.')
  }

  if (esFestivo(t.fecha)) {
    return bloquear('festivo', `${t.fecha} es festivo en Colombia.`)
  }

  const ventana = VENTANA_LEGAL[t.diaSemana]
  if (!ventana) {
    return bloquear('domingo', 'Día sin ventana de contacto permitida.')
  }
  if (t.minutosDelDia < ventana.desde || t.minutosDelDia >= ventana.hasta) {
    return bloquear(
      'fuera_de_horario_legal',
      `${formatearHora(t)} está fuera de la ventana legal (${formatearVentana(ventana)}).`,
    )
  }

  // --- Preferencias del deudor: solo pueden estrechar la ventana, nunca ampliarla ---

  const pref = deudor.preferencia

  if (pref.canal !== null && pref.canal !== canal) {
    return bloquear(
      'canal_distinto_al_preferido',
      `El deudor pidió ser contactado por ${pref.canal}, no por ${canal}.`,
    )
  }

  if (pref.diaSemana !== null && pref.diaSemana !== t.diaSemana) {
    return bloquear(
      'dia_distinto_al_preferido',
      `El deudor pidió ser contactado los días ${pref.diaSemana}, y hoy es ${t.diaSemana}.`,
    )
  }

  if (pref.horaDesde !== null && t.hora < pref.horaDesde) {
    return bloquear(
      'fuera_de_horario_preferido',
      `El deudor pidió contacto desde las ${pref.horaDesde}:00.`,
    )
  }

  if (pref.horaHasta !== null && t.hora >= pref.horaHasta) {
    return bloquear(
      'fuera_de_horario_preferido',
      `El deudor pidió contacto hasta las ${pref.horaHasta}:00.`,
    )
  }

  // --- Frecuencia: se cuenta cruzando canales, nunca por canal ---

  // Se descartan los contactos con fecha ilegible antes de contar.
  //
  // Un `timestamp` que no parsea llega de la vida real: una fila de cartera mal
  // formada, un webhook con un campo raro, una migración a medio hacer. Sin
  // esto, `new Date('cualquier cosa')` produce un Invalid Date y `enBogota`
  // lanza `RangeError`, y una sola fila mala deja al deudor sin poder ser
  // evaluado nunca más. Es mejor contar de menos y seguir operando que romper
  // la evaluación completa: el límite de frecuencia protege al deudor, y un
  // deudor sin evaluar no queda protegido, queda sin sistema.
  const previos = contactosQueCuentan(solicitud.contactosDelDeudor).filter((c) =>
    Number.isFinite(new Date(c.timestamp).getTime()),
  )
  const instanteMs = ahora.getTime()

  const hoy = previos.filter((c) => enBogota(new Date(c.timestamp)).fecha === t.fecha)
  if (hoy.length > 0) {
    return bloquear(
      'limite_diario',
      `Ya hubo ${hoy.length} contacto(s) con este deudor hoy (${t.fecha}).`,
    )
  }

  /**
   * Ventana semanal móvil de 7 días, no semana calendario.
   *
   * La ley dice "una vez por semana" sin definir el corte. Con semana
   * calendario se podría contactar el sábado y otra vez el lunes — dos veces en
   * tres días. La ventana móvil es la lectura que no deja al cliente expuesto.
   *
   * La comparación es en valor absoluto porque el historial puede contener
   * mensajes **ya agendados a futuro**: el planificador difiere envíos a la
   * próxima ventana válida y los deja encolados con su fecha de salida. Mirando
   * solo hacia atrás, un envío agendado para mañana no consumiría cupo y el
   * deudor recibiría dos mensajes en dos días.
   */
  const enLaVentana = previos.filter((c) => {
    const delta = Math.abs(instanteMs - new Date(c.timestamp).getTime())
    return delta < 7 * UN_DIA_MS
  })
  if (enLaVentana.length > 0) {
    const masCercano = enLaVentana.reduce((a, b) =>
      Math.abs(instanteMs - new Date(a.timestamp).getTime()) <=
      Math.abs(instanteMs - new Date(b.timestamp).getTime())
        ? a
        : b,
    )
    const fecha = enBogota(new Date(masCercano.timestamp)).fecha
    const esFuturo = new Date(masCercano.timestamp).getTime() > instanteMs
    return bloquear(
      'limite_semanal',
      esFuturo
        ? `Ya hay un contacto agendado para el ${fecha}, dentro de la ventana de 7 días.`
        : `Ya hubo contacto con este deudor el ${fecha}, dentro de los últimos 7 días.`,
    )
  }

  return { permitido: true, evaluadoEn: t }
}

function formatearHora(t: InstanteBogota): string {
  return `${String(t.hora).padStart(2, '0')}:${String(t.minuto).padStart(2, '0')}`
}

function formatearVentana(v: { desde: number; hasta: number }): string {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return `${fmt(v.desde)}–${fmt(v.hasta)}`
}
