import { createHash, timingSafeEqual } from 'node:crypto'
import type { EstadoPago } from '@/domain/types'

/**
 * Integración con Wompi (Colombia).
 *
 * El dinero nunca pasa por nosotros: la cuenta de Wompi es del cliente y
 * nosotros solo construimos el link y escuchamos el webhook. Eso mantiene el
 * producto fuera de la actividad de agregador/recaudo, que exigiría estructura
 * regulatoria ante la SFC.
 *
 * Se usa el Checkout Web en vez de la API de Payment Links porque el Checkout
 * acepta **nuestra** referencia. Un Payment Link deja que Wompi genere la
 * referencia de la transacción, y sin referencia propia no hay forma de
 * atribuir un pago a un contacto del agente — que es justo lo que sostiene la
 * medición del piloto y el success fee de fase 2.
 */

export interface ConfigWompi {
  /** Llave pública del comercio del cliente. */
  llavePublica: string
  /** Secreto de integridad, para firmar el Checkout. Nunca sale del servidor. */
  secretoIntegridad: string
  /** Secreto de eventos, para validar webhooks. Distinto del anterior. */
  secretoEventos: string
  urlRedireccion?: string
  ambiente: 'test' | 'produccion'
}

const BASE_CHECKOUT = 'https://checkout.wompi.co/p/'

/**
 * Referencia única por intento de cobro.
 *
 * Wompi solo acepta alfanuméricos, guiones y guiones bajos. El prefijo `COB`
 * hace que sea reconocible en la conciliación bancaria del cliente, y el nonce
 * permite reintentar sobre la misma obligación sin colisionar (Wompi rechaza
 * una referencia ya usada por una transacción aprobada).
 */
export function construirReferencia(obligacionId: string, nonce: string): string {
  const limpio = obligacionId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `COB-${limpio}-${nonce}`.slice(0, 255)
}

export function esReferenciaValida(referencia: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(referencia) && referencia.length <= 255
}

/**
 * Firma de integridad del Checkout Web.
 *
 * `SHA256(referencia + montoEnCentavos + moneda [+ expiración] + secreto)`.
 * El orden es parte del contrato con Wompi: alterarlo produce una firma que el
 * checkout rechaza sin explicar por qué.
 */
export function firmaIntegridad(params: {
  referencia: string
  montoEnCentavos: number
  moneda?: string
  expiraEn?: string
  secretoIntegridad: string
}): string {
  const moneda = params.moneda ?? 'COP'
  const partes = [
    params.referencia,
    String(params.montoEnCentavos),
    moneda,
    ...(params.expiraEn ? [params.expiraEn] : []),
    params.secretoIntegridad,
  ]
  return createHash('sha256').update(partes.join(''), 'utf8').digest('hex')
}

/** El COP no se fracciona, pero Wompi cobra en centavos. */
export const pesosACentavos = (pesos: number): number => Math.round(pesos) * 100
export const centavosAPesos = (centavos: number): number => Math.round(centavos / 100)

export interface LinkDePago {
  url: string
  referencia: string
  montoCop: number
  expiraEn: string | null
}

export function construirLinkDePago(
  config: ConfigWompi,
  params: {
    referencia: string
    montoCop: number
    expiraEn?: string
    emailCliente?: string
    telefonoCliente?: string
    nombreCliente?: string
  },
): LinkDePago {
  if (!esReferenciaValida(params.referencia)) {
    throw new Error(`Referencia inválida para Wompi: "${params.referencia}"`)
  }
  if (!Number.isInteger(params.montoCop) || params.montoCop <= 0) {
    throw new Error(`Monto inválido: ${params.montoCop}`)
  }

  const montoEnCentavos = pesosACentavos(params.montoCop)
  const firma = firmaIntegridad({
    referencia: params.referencia,
    montoEnCentavos,
    expiraEn: params.expiraEn,
    secretoIntegridad: config.secretoIntegridad,
  })

  const query = new URLSearchParams({
    'public-key': config.llavePublica,
    currency: 'COP',
    'amount-in-cents': String(montoEnCentavos),
    reference: params.referencia,
    'signature:integrity': firma,
  })
  if (params.expiraEn) query.set('expiration-time', params.expiraEn)
  if (config.urlRedireccion) query.set('redirect-url', config.urlRedireccion)
  if (params.emailCliente) query.set('customer-data:email', params.emailCliente)
  if (params.telefonoCliente) query.set('customer-data:phone-number', params.telefonoCliente)
  if (params.nombreCliente) query.set('customer-data:full-name', params.nombreCliente)

  return {
    url: `${BASE_CHECKOUT}?${query.toString()}`,
    referencia: params.referencia,
    montoCop: params.montoCop,
    expiraEn: params.expiraEn ?? null,
  }
}

// --- Webhooks ---

export interface EventoWompi {
  event: string
  data: Record<string, unknown>
  environment?: string
  signature: { properties: string[]; checksum: string }
  timestamp: number
  sent_at?: string
}

function leerRuta(objeto: Record<string, unknown>, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[parte]
    return undefined
  }, objeto)
}

/**
 * Valida el checksum del webhook.
 *
 * `SHA256(valores de signature.properties en orden + timestamp + secretoEventos)`.
 * Wompi decide qué propiedades entran y las declara en el propio evento, así
 * que no se pueden asumir: hay que leerlas del payload.
 *
 * Sin esta validación, cualquiera que conozca la URL del webhook podría
 * declarar pagada una obligación y apagarle la cadencia a un deudor moroso.
 */
export function verificarChecksumWebhook(evento: EventoWompi, secretoEventos: string): boolean {
  if (!evento?.signature?.properties || !evento.signature.checksum) return false

  const valores = evento.signature.properties.map((ruta) => {
    const v = leerRuta(evento.data, ruta)
    return v === null || v === undefined ? '' : String(v)
  })

  const calculado = createHash('sha256')
    .update(`${valores.join('')}${evento.timestamp}${secretoEventos}`, 'utf8')
    .digest('hex')

  return comparacionSegura(calculado, evento.signature.checksum)
}

/** Comparación en tiempo constante, para no filtrar el checksum por temporización. */
function comparacionSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

const ESTADOS_WOMPI: Record<string, EstadoPago> = {
  APPROVED: 'aprobado',
  DECLINED: 'declinado',
  VOIDED: 'anulado',
  ERROR: 'error',
  PENDING: 'pendiente',
}

export interface PagoInterpretado {
  referencia: string
  transaccionId: string
  estado: EstadoPago
  montoCop: number
  metodoPago: string | null
  ocurrioEn: string
}

/**
 * Traduce un evento de transacción al modelo interno. Devuelve `null` si el
 * evento no es de transacción: Wompi también envía eventos de nequi y de
 * fuentes de pago que no nos interesan.
 */
export function interpretarEvento(evento: EventoWompi): PagoInterpretado | null {
  const transaccion = evento.data?.transaction as Record<string, unknown> | undefined
  if (!transaccion) return null

  const estadoCrudo = String(transaccion.status ?? '')
  return {
    referencia: String(transaccion.reference ?? ''),
    transaccionId: String(transaccion.id ?? ''),
    estado: ESTADOS_WOMPI[estadoCrudo] ?? 'error',
    montoCop: centavosAPesos(Number(transaccion.amount_in_cents ?? 0)),
    metodoPago: transaccion.payment_method_type ? String(transaccion.payment_method_type) : null,
    ocurrioEn: evento.sent_at ?? new Date(evento.timestamp * 1000).toISOString(),
  }
}

/**
 * Ventana de atribución al agente.
 *
 * Un pago cuenta como recuperado por el agente si entra dentro de los 7 días
 * siguientes a un contacto suyo Y llegó por la referencia que él generó. Las
 * dos condiciones juntas hacen que la cifra sea defendible frente al cliente
 * en la liquidación del success fee.
 */
export const DIAS_VENTANA_ATRIBUCION = 7

export function esAtribuibleAlAgente(
  pagadoEn: string,
  ultimoContactoDelAgente: string | null,
): boolean {
  if (!ultimoContactoDelAgente) return false
  const delta = new Date(pagadoEn).getTime() - new Date(ultimoContactoDelAgente).getTime()
  return delta >= 0 && delta <= DIAS_VENTANA_ATRIBUCION * 86_400_000
}
