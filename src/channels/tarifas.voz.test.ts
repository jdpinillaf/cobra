import { describe, expect, it } from 'vitest'
import { costoDeLlamadaCop, TARIFA_META, TARIFA_TWILIO_VOZ_CO } from './tarifas'

describe('tarifas de voz', () => {
  /** El redondeo es la diferencia entre estimar bien y estimar de menos. */
  it('Twilio redondea al minuto hacia arriba', () => {
    expect(TARIFA_TWILIO_VOZ_CO.costoCop(1)).toBeCloseTo(TARIFA_TWILIO_VOZ_CO.costoCop(60), 6)
    expect(TARIFA_TWILIO_VOZ_CO.costoCop(61)).toBeCloseTo(TARIFA_TWILIO_VOZ_CO.costoCop(120), 6)
  })

  it('parte el costo en telefonía e IA', () => {
    const c = costoDeLlamadaCop(90)
    expect(c.telefoniaCop).toBeGreaterThan(0)
    expect(c.iaCop).toBeGreaterThan(0)
    expect(c.totalCop).toBeCloseTo(c.telefoniaCop + c.iaCop, 6)
    // Una llamada de minuto y medio, todo incluido, ronda los COP 772.
    expect(Math.round(c.totalCop)).toBeGreaterThan(700)
    expect(Math.round(c.totalCop)).toBeLessThan(850)
  })

  /**
   * El número que decide el modelo de negocio, escrito acá y no en un markdown:
   * cerrar el mismo acuerdo por voz cuesta cientos de veces lo que cuesta por
   * WhatsApp dentro de la ventana de servicio, que vale cero. Por eso la voz es
   * el segundo intento y se cobra aparte.
   */
  it('una llamada de 3 minutos cuesta cientos de veces un WhatsApp', () => {
    const voz = costoDeLlamadaCop(180).totalCop
    const whatsappServicio = TARIFA_META.costoCop('whatsapp', 'servicio')
    const whatsappPlantilla = TARIFA_META.costoCop('whatsapp', 'utility')

    expect(whatsappServicio).toBe(0)
    expect(voz).toBeGreaterThan(whatsappPlantilla * 300)
  })
})
