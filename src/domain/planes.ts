import type { Canal, Tier } from './types'

/**
 * Planes comerciales (Colombia).
 *
 * El cupo de mensajes cuenta entrantes y salientes. La regla nació cuando el
 * canal iba por un revendedor que cobraba ambos; con Meta Cloud API directo el
 * tráfico conversacional es gratis, así que **el cupo dejó de recuperar costo y
 * pasó a ser margen**. Se mantiene a propósito: acota el uso del agente, da
 * colchón para cambiar de proveedor sin re-precificar, y una sola cifra en la
 * factura es más fácil de vender que dos.
 *
 * Conviene no confundir las dos cosas al negociar: bajar el cupo hoy no evita
 * un costo, cede margen.
 *
 * Los tramos tienen techo de deudores a propósito: un tier de precio plano y
 * sin tope se vuelve una pérdida garantizada apenas entra un cliente grande.
 */
export interface Plan {
  tier: Tier
  etiqueta: string
  deudoresMax: number | null
  mensajesIncluidos: number
  setupCop: number
  mensualidadCop: number
  /** Por deudor y por mes, solo en el tier corporativo. */
  variablePorDeudorCop: number
}

export const PLANES: Readonly<Record<Tier, Plan>> = {
  pequena: {
    tier: 'pequena',
    etiqueta: 'Pequeña',
    deudoresMax: 500,
    mensajesIncluidos: 3_000,
    setupCop: 1_500_000,
    mensualidadCop: 400_000,
    variablePorDeudorCop: 0,
  },
  mediana: {
    tier: 'mediana',
    etiqueta: 'Mediana',
    deudoresMax: 2_000,
    mensajesIncluidos: 12_000,
    setupCop: 3_500_000,
    mensualidadCop: 800_000,
    variablePorDeudorCop: 0,
  },
  grande: {
    tier: 'grande',
    etiqueta: 'Grande',
    deudoresMax: 3_000,
    mensajesIncluidos: 18_000,
    setupCop: 8_000_000,
    mensualidadCop: 1_200_000,
    variablePorDeudorCop: 0,
  },
  corporativo: {
    tier: 'corporativo',
    etiqueta: 'Corporativo',
    deudoresMax: null,
    mensajesIncluidos: 18_000,
    setupCop: 8_000_000,
    mensualidadCop: 1_200_000,
    variablePorDeudorCop: 400,
  },
}

/** Overage de WhatsApp: COP 45.000 por cada 1.000 mensajes. */
export const COP_POR_MENSAJE_ADICIONAL = 45

/**
 * El SMS nunca sale del cupo: cuesta COP 210 y el overage se cobra a 45. Se
 * factura aparte, prepago, con margen propio.
 */
export const COP_POR_SMS_ADICIONAL = 280

export const ADDON_CARTERA_CASTIGADA_COP = 300_000

export function planPara(deudores: number): Plan {
  if (deudores <= PLANES.pequena.deudoresMax!) return PLANES.pequena
  if (deudores <= PLANES.mediana.deudoresMax!) return PLANES.mediana
  if (deudores <= PLANES.grande.deudoresMax!) return PLANES.grande
  return PLANES.corporativo
}

export interface Factura {
  plan: Plan
  mensualidadCop: number
  mensajesIncluidos: number
  mensajesWhatsapp: number
  mensajesSms: number
  excedenteWhatsapp: number
  excedenteWhatsappCop: number
  smsCop: number
  totalCop: number
}

/**
 * Liquida un mes.
 *
 * El SMS se factura completo por fuera del cupo, así que solo los mensajes de
 * WhatsApp consumen los incluidos.
 */
export function liquidarMes(params: {
  deudoresGestionados: number
  mensajesPorCanal: Record<Canal, number>
  addonCarteraCastigada?: boolean
}): Factura {
  const plan = planPara(params.deudoresGestionados)
  const mensajesWhatsapp = params.mensajesPorCanal.whatsapp
  const mensajesSms = params.mensajesPorCanal.sms

  const excedenteWhatsapp = Math.max(0, mensajesWhatsapp - plan.mensajesIncluidos)
  const excedenteWhatsappCop = excedenteWhatsapp * COP_POR_MENSAJE_ADICIONAL
  const smsCop = mensajesSms * COP_POR_SMS_ADICIONAL

  const mensualidadCop =
    plan.mensualidadCop + plan.variablePorDeudorCop * params.deudoresGestionados

  return {
    plan,
    mensualidadCop,
    mensajesIncluidos: plan.mensajesIncluidos,
    mensajesWhatsapp,
    mensajesSms,
    excedenteWhatsapp,
    excedenteWhatsappCop,
    smsCop,
    totalCop:
      mensualidadCop +
      excedenteWhatsappCop +
      smsCop +
      (params.addonCarteraCastigada ? ADDON_CARTERA_CASTIGADA_COP : 0),
  }
}
