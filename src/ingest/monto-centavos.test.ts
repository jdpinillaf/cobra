import { describe, expect, it } from 'vitest'
import { normalizarMontoCentavos } from './normalizar'

/**
 * El §1 del plan de conciliación exige centavos enteros y prohíbe float.
 * `normalizarMonto` ya resuelve la parte difícil (decidir cuál separador es de
 * miles y cuál decimal), pero devuelve pesos redondeados: `$0,50` se vuelve 1.
 * En cartera eso da igual, en conciliación un peso de diferencia es un cruce que
 * no ocurre.
 */
describe('normalizarMontoCentavos', () => {
  it.each([
    // Las dos plantillas reales de Bancolombia.
    ['$100,000.00', 10_000_000],
    ['$600,000', 60_000_000],
    // Formato colombiano, por si algún día llega así.
    ['1.500.000', 150_000_000],
    ['12.345.678,90', 1_234_567_890],
    // El caso que rompía al `parseMonto` del plan: centavos sin separador de
    // miles. Lo leía como $50.000, cien veces de más.
    ['500.00', 50_000],
    ['0.50', 50],
    ['0,05', 5],
    // Sin decimales ni separadores.
    ['900', 90_000],
    ['1,000.00', 100_000],
    // Punto con exactamente tres dígitos es separador de miles en Colombia,
    // no dos decimales y pico. `normalizarMonto` ya decidía esto bien.
    ['100.123', 10_012_300],
    ['$ 1.245.000', 124_500_000],
    ['COP 850.000', 85_000_000],
  ])('%s → %s centavos', (crudo, esperado) => {
    const r = normalizarMontoCentavos(crudo)
    expect(r.ok && r.valor).toBe(esperado)
  })

  it('no pierde precisión donde un float la perdería', () => {
    // 0.1 + 0.2 !== 0.3 en float. En centavos enteros el problema no existe.
    const r = normalizarMontoCentavos('1234567.89')
    expect(r.ok && r.valor).toBe(123_456_789)
  })

  it.each(['abc', '', '   ', '$'])(
    'rechaza %s en vez de devolver cero, porque un cero concilia contra cualquier cosa',
    (basura) => {
      const r = normalizarMontoCentavos(basura)
      expect(r.ok).toBe(false)
    },
  )

  it('rechaza más de dos decimales porque no existe medio centavo', () => {
    const r = normalizarMontoCentavos('100.1234')
    expect(r.ok).toBe(false)
  })
})
