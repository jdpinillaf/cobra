import { describe, expect, it } from 'vitest'
import { TARIFA_META, TARIFA_TWILIO_WHATSAPP_HISTORICA } from '@/channels/tarifas'
import { COP_POR_MENSAJE_ADICIONAL, PLANES, liquidarMes, planPara } from './planes'

describe('planPara', () => {
  it.each([
    [1, 'pequena'],
    [500, 'pequena'],
    [501, 'mediana'],
    [2_000, 'mediana'],
    [2_001, 'grande'],
    [3_000, 'grande'],
    [3_001, 'corporativo'],
    [20_000, 'corporativo'],
  ] as const)('%i deudores → plan %s', (deudores, tier) => {
    expect(planPara(deudores).tier).toBe(tier)
  })
})

describe('liquidarMes', () => {
  it('no cobra excedente mientras el consumo quepa en el cupo', () => {
    const f = liquidarMes({
      deudoresGestionados: 400,
      mensajesPorCanal: { whatsapp: 2_500, sms: 0 },
    })
    expect(f.plan.tier).toBe('pequena')
    expect(f.excedenteWhatsapp).toBe(0)
    expect(f.totalCop).toBe(400_000)
  })

  it('cobra el excedente de WhatsApp a COP 45 por mensaje', () => {
    const f = liquidarMes({
      deudoresGestionados: 400,
      mensajesPorCanal: { whatsapp: 4_000, sms: 0 },
    })
    expect(f.excedenteWhatsapp).toBe(1_000)
    expect(f.excedenteWhatsappCop).toBe(45_000)
    expect(f.totalCop).toBe(445_000)
  })

  it('el SMS nunca sale del cupo: se factura aparte', () => {
    // A COP 45 de overage se perdería plata en cada SMS, que cuesta COP 210.
    const f = liquidarMes({
      deudoresGestionados: 400,
      mensajesPorCanal: { whatsapp: 1_000, sms: 500 },
    })
    expect(f.excedenteWhatsapp).toBe(0)
    expect(f.smsCop).toBe(500 * 280)
    expect(f.totalCop).toBe(400_000 + 140_000)
  })

  it('el corporativo cobra una variable por deudor sobre la base', () => {
    const f = liquidarMes({
      deudoresGestionados: 10_000,
      mensajesPorCanal: { whatsapp: 18_000, sms: 0 },
    })
    expect(f.plan.tier).toBe('corporativo')
    expect(f.mensualidadCop).toBe(1_200_000 + 10_000 * 400)
  })

  it('suma el add-on de cartera castigada', () => {
    const f = liquidarMes({
      deudoresGestionados: 400,
      mensajesPorCanal: { whatsapp: 100, sms: 0 },
      addonCarteraCastigada: true,
    })
    expect(f.totalCop).toBe(400_000 + 300_000)
  })
})

/**
 * Estas pruebas defienden el margen. El listado original tenía un tier
 * "+2.000 deudores" a precio plano y sin techo, que con 10.000 deudores costaba
 * más de lo que facturaba. El techo por tier y el overage son lo que lo arregla.
 */
describe('el margen aguanta en cada tier', () => {
  /** Ley 2300: como máximo un contacto semanal, ~4.3 al mes por deudor. */
  const MENSAJES_POR_DEUDOR_MES = 4.3
  /** Tráfico conversacional entrante, estimado como 30% extra sobre lo saliente. */
  const FACTOR_INBOUND = 1.3

  const COSTO_PLANTILLA = TARIFA_META.costoCop('whatsapp', 'utility')

  /**
   * Con Meta directo solo cuestan las plantillas salientes. Lo entrante y las
   * respuestas dentro de la ventana de 24 h valen cero, aunque sí consumen
   * cupo: contarlas es una decisión comercial, no un traslado de costo.
   */
  const costoReal = (deudores: number): number =>
    Math.round(deudores * MENSAJES_POR_DEUDOR_MES) * COSTO_PLANTILLA

  const mensajesFacturados = (deudores: number): number =>
    Math.round(deudores * MENSAJES_POR_DEUDOR_MES * FACTOR_INBOUND)

  it.each(['pequena', 'mediana', 'grande'] as const)(
    'el tier %s conserva al menos 55% de margen bruto a plena carga',
    (tier) => {
      const plan = PLANES[tier]
      const deudores = plan.deudoresMax!

      const factura = liquidarMes({
        deudoresGestionados: deudores,
        mensajesPorCanal: { whatsapp: mensajesFacturados(deudores), sms: 0 },
      })
      const margen = (factura.totalCop - costoReal(deudores)) / factura.totalCop

      expect(margen, `margen de ${tier}: ${(margen * 100).toFixed(1)}%`).toBeGreaterThan(0.55)
    },
  )

  it('el overage deja margen positivo, no lo destruye', () => {
    expect(COP_POR_MENSAJE_ADICIONAL).toBeGreaterThan(COSTO_PLANTILLA)
  })

  it('un cliente de 20.000 deudores ya no da pérdida', () => {
    // Este es el caso que quebraba el tier plano original.
    const deudores = 20_000
    const factura = liquidarMes({
      deudoresGestionados: deudores,
      mensajesPorCanal: { whatsapp: mensajesFacturados(deudores), sms: 0 },
    })
    const costo = costoReal(deudores)

    expect(factura.totalCop).toBeGreaterThan(costo)
    expect((factura.totalCop - costo) / factura.totalCop).toBeGreaterThan(0.5)
  })
})

/**
 * La decisión de dejar el revendedor queda asertada, no solo escrita en un
 * markdown: si alguien vuelve a meter un BSP en la ruta de WhatsApp, estas
 * pruebas dicen cuánto cuesta.
 */
describe('por qué Meta directo y no un revendedor', () => {
  it('una plantilla utility en Colombia cuesta ~7 veces menos', () => {
    const meta = TARIFA_META.costoCop('whatsapp', 'utility')
    const bsp = TARIFA_TWILIO_WHATSAPP_HISTORICA.costoCop('whatsapp', 'utility')

    expect(meta).toBeCloseTo(3.2, 2)
    expect(bsp).toBeCloseTo(24, 2)
    expect(bsp / meta).toBeGreaterThan(7)
  })

  it('el tráfico conversacional pasa de costar a ser gratis', () => {
    // Es el grueso del tráfico de un agente conversacional, y es donde el
    // revendedor cobra su comisión sobre algo que Meta regala.
    expect(TARIFA_META.costoCop('whatsapp', 'servicio')).toBe(0)
    expect(TARIFA_TWILIO_WHATSAPP_HISTORICA.costoCop('whatsapp', 'servicio')).toBeGreaterThan(0)
  })

  it('Meta no vende SMS: por eso el fallback sigue en otro proveedor', () => {
    expect(() => TARIFA_META.costoCop('sms', 'utility')).toThrow(/no vende sms/i)
  })
})
