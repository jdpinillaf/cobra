import type { Canal, CategoriaPlantilla } from '@/domain/types'

/**
 * Tarifas de mensajería, por proveedor y por categoría.
 *
 * Antes esto era una constante `Record<Canal, number>`. Dejó de servir por dos
 * razones: el costo depende de quién envía (Meta directo contra un revendedor)
 * y de qué se envía (una plantilla `marketing` cuesta ~25x una `utility`), y
 * hay una categoría que **vale cero**.
 *
 * Todo se deriva de la tarifa en USD para que sea auditable contra el rate card
 * de Meta y contra la factura del proveedor.
 */

/** Tasa de referencia del modelo de negocio. */
export const TASA_COP_POR_USD = 4_000

/**
 * Categoría a efectos de facturación.
 *
 * `servicio` es el texto libre que se responde dentro de la ventana de 24 h
 * abierta por un mensaje del deudor. Meta no lo cobra, sin tope mensual, desde
 * el 1 de noviembre de 2024. Es la categoría donde vive el grueso del tráfico
 * de un agente conversacional, y la razón principal para no ir por un
 * revendedor: un BSP cobra su comisión por mensaje también aquí.
 */
export type CategoriaFacturable = CategoriaPlantilla | 'servicio'

export interface Tarifa {
  readonly nombre: string
  /** COP por mensaje. Puede ser fraccionario: una `utility` colombiana vale COP 3,2. */
  costoCop(canal: Canal, categoria: CategoriaFacturable): number
}

const usdACop = (usd: number): number => usd * TASA_COP_POR_USD

/**
 * Meta WhatsApp Cloud API, directo, tarifas de Colombia.
 *
 * Rate card vigente desde el 1 de abril de 2026. Colombia es de los mercados
 * más baratos del mundo para `utility` y `authentication`. Desde el 1 de julio
 * de 2025 Meta cobra por mensaje entregado, no por conversación de 24 h.
 *
 * La tarifa la fija el **indicativo del destinatario**, no el país del negocio.
 * Un deudor con celular de otro país se cobra a la tarifa de ese país.
 */
export const TARIFA_META: Tarifa = {
  nombre: 'meta',
  costoCop(canal, categoria) {
    if (canal !== 'whatsapp') {
      throw new Error(`Meta Cloud API no vende ${canal}: solo WhatsApp.`)
    }
    switch (categoria) {
      case 'utility':
      case 'authentication':
        return usdACop(0.0008)
      case 'marketing':
        return usdACop(0.02)
      case 'servicio':
        // Ventana de servicio de 24 h. Gratis y sin tope.
        return 0
    }
  },
}

/**
 * Twilio, solo SMS.
 *
 * Se queda únicamente para el fallback: Meta no vende SMS y Colombia exige
 * short code (el sender alfanumérico se sobrescribe y los números largos
 * virtuales están prohibidos).
 */
export const TARIFA_TWILIO_SMS: Tarifa = {
  nombre: 'twilio-sms',
  costoCop(canal) {
    if (canal !== 'sms') {
      throw new Error(`Twilio quedó reducido a SMS; ${canal} va por Meta directo.`)
    }
    return usdACop(0.0525)
  },
}

/**
 * Tarifa histórica de Twilio para WhatsApp. **No se usa para enviar.**
 *
 * Se conserva como referencia auditable de lo que costaba antes de migrar:
 * USD 0.001 de Meta más USD 0.005 de comisión de Twilio, cobrada tanto en
 * entrantes como en salientes. Los tests de margen la comparan contra
 * `TARIFA_META` para que la decisión quede documentada en código y no solo en
 * un markdown.
 */
export const TARIFA_TWILIO_WHATSAPP_HISTORICA: Tarifa = {
  nombre: 'twilio-whatsapp-historica',
  costoCop(canal, categoria) {
    if (canal !== 'whatsapp') return usdACop(0.0525)
    const meta = categoria === 'marketing' ? 0.02 : 0.001
    // La comisión de Twilio se cobra igual en `servicio`, que en Meta es gratis.
    return usdACop(meta + 0.005)
  },
}
