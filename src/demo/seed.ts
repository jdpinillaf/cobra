import type { Cadencia, Cliente, Deudor, Obligacion, Plantilla } from '@/domain/types'
import { calcularTramo } from '@/cadence/planificador'
import { calcularDiasMora } from '@/ingest/normalizar'

/**
 * Cartera ficticia para la demo de venta.
 *
 * Los datos son inventados pero la *forma* es real: distribución de mora
 * cargada hacia la temprana, saldos de microcrédito colombiano, y una fracción
 * de deudores con teléfono malo o sin consentimiento, porque ninguna base
 * llega limpia y la demo no debe mentir sobre eso.
 */

/** PRNG determinista: la misma semilla produce la misma demo en cada corrida. */
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const NOMBRES = ['Ana', 'Luis', 'María', 'Carlos', 'Diana', 'Jorge', 'Paula', 'Andrés', 'Laura', 'Miguel', 'Sandra', 'Julián', 'Claudia', 'Óscar', 'Natalia', 'Fernando']
const APELLIDOS = ['Ruiz', 'Pérez', 'Gómez', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'Díaz', 'Moreno', 'Vargas', 'Castro', 'Ramírez', 'Ospina', 'Cardona', 'Quintero', 'Zapata']

export interface CarteraDemo {
  cliente: Cliente
  deudores: Deudor[]
  obligaciones: Obligacion[]
  plantillas: Plantilla[]
  cadencias: Cadencia[]
}

/**
 * Distribución de mora del portafolio. Suma 1. Está cargada hacia la mora
 * temprana porque es donde un prestamista tiene el grueso de su cartera viva y
 * donde el agente rinde más.
 */
const DISTRIBUCION_MORA: ReadonlyArray<[min: number, max: number, peso: number]> = [
  [-10, 0, 0.15], // aún no vence → cadencia preventiva
  [1, 30, 0.4],
  [31, 90, 0.25],
  [91, 180, 0.12],
  [181, 400, 0.08],
]

/**
 * Ticket promedio por defecto: COP 1,2M, el rango típico de un microcrédito
 * colombiano. La landing deja al prospecto cambiarlo por el suyo.
 */
export const TICKET_PROMEDIO_POR_DEFECTO = 1_200_000

/**
 * Dispersión del capital alrededor del ticket promedio. ±60% produce una
 * cartera con la variedad de una base real sin generar saldos absurdos.
 */
const DISPERSION_TICKET = 0.6

export function generarCartera(opciones: {
  cantidad: number
  fechaCorte: string
  semilla?: number
  clienteId?: string
  /** Capital promedio por obligación, en pesos. */
  ticketPromedioCop?: number
}): CarteraDemo {
  const { cantidad, fechaCorte } = opciones
  const clienteId = opciones.clienteId ?? 'demo'
  const ticket = Math.max(1, Math.round(opciones.ticketPromedioCop ?? TICKET_PROMEDIO_POR_DEFECTO))
  const capitalMin = Math.round(ticket * (1 - DISPERSION_TICKET))
  const capitalRango = Math.round(ticket * DISPERSION_TICKET * 2)
  const rnd = mulberry32(opciones.semilla ?? 42)

  const deudores: Deudor[] = []
  const obligaciones: Obligacion[] = []

  for (let i = 0; i < cantidad; i++) {
    const documento = String(1_000_000_000 + Math.floor(rnd() * 99_999_999))
    const nombre = `${NOMBRES[Math.floor(rnd() * NOMBRES.length)]} ${APELLIDOS[Math.floor(rnd() * APELLIDOS.length)]}`
    const celular = `+573${String(Math.floor(rnd() * 1_000_000_000)).padStart(9, '0')}`

    // ~4% sin consentimiento y ~3% con opt-out: el guard tiene que excluirlos y
    // la demo tiene que mostrarlo, porque es lo que pasa con una base real.
    const sorteo = rnd()
    const sinConsentimiento = sorteo < 0.04
    const conOptOut = sorteo >= 0.04 && sorteo < 0.07

    deudores.push({
      id: `deu_${documento}`,
      clienteId,
      tipoDocumento: 'CC',
      documento,
      nombre,
      telefonos: [celular],
      email: null,
      rol: 'titular',
      consentimiento: {
        otorgado: !sinConsentimiento,
        fuente: 'pagare',
        fecha: '2025-06-01',
        revocadoEn: conOptOut ? '2026-07-15' : null,
      },
      // ~8% fijó una preferencia de contacto, como permite la Ley 2300.
      preferencia:
        rnd() < 0.08
          ? { canal: null, diaSemana: null, horaDesde: 14, horaHasta: 18 }
          : { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
      numeroErradoEn: null,
    })

    const diasMora = sortearDiasMora(rnd)
    const fechaVencimiento = restarDias(fechaCorte, diasMora)
    const capital = capitalMin + Math.floor(rnd() * capitalRango)
    const interesMora = diasMora > 0 ? Math.floor(capital * 0.02 * (diasMora / 30)) : 0

    obligaciones.push({
      id: `obl_${documento}`,
      clienteId,
      deudorId: `deu_${documento}`,
      numeroCredito: `CR-${String(i + 1).padStart(5, '0')}`,
      capital,
      interesMora,
      saldoTotal: capital + interesMora,
      fechaVencimiento,
      diasMora,
      tramo: calcularTramo(diasMora),
      estado: diasMora > 0 ? 'en_mora' : 'al_dia',
    })
  }

  return {
    cliente: clienteDemo(clienteId),
    deudores,
    obligaciones,
    plantillas: plantillasDemo(clienteId),
    cadencias: cadenciasDemo(clienteId),
  }
}

function sortearDiasMora(rnd: () => number): number {
  const r = rnd()
  let acumulado = 0
  for (const [min, max, peso] of DISTRIBUCION_MORA) {
    acumulado += peso
    if (r <= acumulado) return min + Math.floor(rnd() * (max - min + 1))
  }
  return 15
}

function restarDias(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`)
  return new Date(base.getTime() - dias * 86_400_000).toISOString().slice(0, 10)
}

function clienteDemo(clienteId: string): Cliente {
  return {
    id: clienteId,
    nombre: 'Créditos del Valle S.A.S.',
    tier: 'mediana',
    cupoMensajesMes: 12_000,
    zonaHoraria: 'America/Bogota',
    limitesPorTramo: {
      // En preventiva no hay nada que negociar: el crédito ni siquiera venció.
      preventiva: { descuentoMaxPct: 0, cuotasMax: 1, diasPlazoMax: 0, montoMinimoAbono: 0 },
      temprana: { descuentoMaxPct: 0, cuotasMax: 2, diasPlazoMax: 15, montoMinimoAbono: 50_000 },
      media: { descuentoMaxPct: 10, cuotasMax: 4, diasPlazoMax: 30, montoMinimoAbono: 100_000 },
      tardia: { descuentoMaxPct: 25, cuotasMax: 6, diasPlazoMax: 45, montoMinimoAbono: 100_000 },
      // En castigada el saldo ya se dio por perdido: recuperar el 50% es ganancia.
      castigada: { descuentoMaxPct: 50, cuotasMax: 12, diasPlazoMax: 60, montoMinimoAbono: 50_000 },
    },
  }
}

/**
 * Plantillas de la demo.
 *
 * Todas son categoría `utility`: informan sobre una obligación existente y no
 * llevan lenguaje promocional. La de castigada ofrece un descuento, así que
 * Meta la clasificaría como `marketing` — queda marcada como tal para que el
 * costo del cupo no se subestime.
 */
function plantillasDemo(clienteId: string): Plantilla[] {
  const base = { clienteId, canal: 'whatsapp' as const, aprobadaEnMeta: true }
  return [
    {
      ...base,
      id: 'p_preaviso',
      nombre: 'preaviso_vencimiento',
      categoria: 'utility',
      nombreMeta: 'preaviso_vencimiento_v1',
      cuerpo:
        'Hola {{1}}, te recordamos que tu cuota del crédito {{2}} por {{3}} vence el {{4}}. Puedes pagarla aquí: {{5}}',
      variables: ['nombre', 'credito', 'monto', 'fecha', 'link'],
    },
    {
      ...base,
      id: 'p_temprana',
      nombre: 'recordatorio_mora_temprana',
      categoria: 'utility',
      nombreMeta: 'recordatorio_mora_temprana_v1',
      cuerpo:
        'Hola {{1}}, tu crédito {{2}} presenta un saldo pendiente de {{3}}. Puedes ponerte al día aquí: {{4}}',
      variables: ['nombre', 'credito', 'monto', 'link'],
    },
    {
      ...base,
      id: 'p_media',
      nombre: 'acuerdo_de_pago',
      categoria: 'utility',
      nombreMeta: 'acuerdo_de_pago_v1',
      cuerpo:
        'Hola {{1}}, tu crédito {{2}} tiene {{3}} días de mora y un saldo de {{4}}. Escríbenos y armamos un acuerdo a tu medida, o paga aquí: {{5}}',
      variables: ['nombre', 'credito', 'dias', 'monto', 'link'],
    },
    {
      ...base,
      id: 'p_castigada',
      nombre: 'oferta_cierre_cartera',
      // Lleva oferta de descuento: Meta la cobra como marketing, no como utility.
      categoria: 'marketing',
      nombreMeta: 'oferta_cierre_cartera_v1',
      cuerpo:
        'Hola {{1}}, tenemos una propuesta para cerrar tu crédito {{2}}. Paga {{3}} y queda a paz y salvo: {{4}}',
      variables: ['nombre', 'credito', 'monto', 'link'],
    },
  ]
}

/**
 * Cadencias por tramo.
 *
 * Los offsets se cuentan desde la fecha de vencimiento y están espaciados a 7+
 * días porque la Ley 2300 no permite más de un contacto semanal. Poner pasos
 * más juntos no acelera nada: el guard los bloquearía y solo ensuciaría el log.
 */
function cadenciasDemo(clienteId: string): Cadencia[] {
  const base = { clienteId, activa: true }
  return [
    {
      ...base,
      id: 'cad_preventiva',
      tramo: 'preventiva',
      pasos: [{ offsetDias: -3, canal: 'whatsapp', plantillaId: 'p_preaviso', fallbackSms: false }],
    },
    {
      ...base,
      id: 'cad_temprana',
      tramo: 'temprana',
      pasos: [
        { offsetDias: 2, canal: 'whatsapp', plantillaId: 'p_temprana', fallbackSms: true },
        { offsetDias: 10, canal: 'whatsapp', plantillaId: 'p_temprana', fallbackSms: true },
        { offsetDias: 18, canal: 'whatsapp', plantillaId: 'p_temprana', fallbackSms: true },
        { offsetDias: 26, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
      ],
    },
    {
      ...base,
      id: 'cad_media',
      tramo: 'media',
      pasos: [
        { offsetDias: 35, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
        { offsetDias: 45, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
        { offsetDias: 60, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
        { offsetDias: 75, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
      ],
    },
    {
      ...base,
      id: 'cad_tardia',
      tramo: 'tardia',
      pasos: [
        { offsetDias: 95, canal: 'whatsapp', plantillaId: 'p_media', fallbackSms: true },
        { offsetDias: 120, canal: 'whatsapp', plantillaId: 'p_castigada', fallbackSms: true },
        { offsetDias: 150, canal: 'whatsapp', plantillaId: 'p_castigada', fallbackSms: true },
      ],
    },
    {
      ...base,
      id: 'cad_castigada',
      tramo: 'castigada',
      pasos: [
        { offsetDias: 190, canal: 'whatsapp', plantillaId: 'p_castigada', fallbackSms: false },
        { offsetDias: 220, canal: 'whatsapp', plantillaId: 'p_castigada', fallbackSms: false },
      ],
    },
  ]
}

export { calcularDiasMora, mulberry32 }
