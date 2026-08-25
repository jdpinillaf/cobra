import { describe, expect, it } from 'vitest'
import { COP_POR_MINUTO_VOZ_ADICIONAL, liquidarMes, PLANES } from './planes'
import { costoDeLlamadaCop } from '@/channels/tarifas'

const SIN_MENSAJES = { whatsapp: 0, sms: 0 }

describe('la voz en la factura', () => {
  it('los 100 minutos incluidos no se cobran', () => {
    const f = liquidarMes({ deudoresGestionados: 400, mensajesPorCanal: SIN_MENSAJES, minutosVoz: 100 })
    expect(f.excedenteVoz).toBe(0)
    expect(f.excedenteVozCop).toBe(0)
    expect(f.totalCop).toBe(PLANES.pequena.mensualidadCop)
  })

  it('el excedente se cobra por minuto', () => {
    const f = liquidarMes({ deudoresGestionados: 400, mensajesPorCanal: SIN_MENSAJES, minutosVoz: 150 })
    expect(f.excedenteVoz).toBe(50)
    expect(f.excedenteVozCop).toBe(50 * COP_POR_MINUTO_VOZ_ADICIONAL)
  })

  /**
   * La regla que protege el margen: la voz **no** sale del cupo de mensajes.
   * Si saliera, un cliente gastaría su plan entero en veinte llamadas y le
   * cobraríamos COP 45 por algo que nos costó COP 772.
   */
  it('la voz no consume el cupo de mensajes', () => {
    const conVoz = liquidarMes({
      deudoresGestionados: 400,
      mensajesPorCanal: { whatsapp: 3_000, sms: 0 },
      minutosVoz: 100,
    })
    expect(conVoz.excedenteWhatsapp).toBe(0)
    expect(conVoz.mensajesWhatsapp).toBe(PLANES.pequena.mensajesIncluidos)
  })

  /** El precio tiene que dejar margen contra el costo real de la llamada. */
  it('COP 1.500 el minuto deja margen sobre el costo real', () => {
    const costoDelMinuto = costoDeLlamadaCop(60).totalCop
    expect(costoDelMinuto).toBeLessThan(COP_POR_MINUTO_VOZ_ADICIONAL)
    const margen = 1 - costoDelMinuto / COP_POR_MINUTO_VOZ_ADICIONAL
    expect(margen).toBeGreaterThan(0.6)
  })

  /**
   * El número que decidió el modelo: a 25 llamadas de minuto y medio por día
   * hábil, la voz incluida en la mensualidad se comería el plan chico entero.
   * Por eso va aparte.
   */
  it('sin cobrarla aparte, la voz se come la mensualidad Pequeña', () => {
    const costoMensual = costoDeLlamadaCop(90).totalCop * 25 * 22
    expect(costoMensual).toBeGreaterThan(PLANES.pequena.mensualidadCop)
  })
})
