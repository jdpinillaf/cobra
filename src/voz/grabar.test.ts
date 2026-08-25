import { describe, expect, it } from 'vitest'
import { montoEnPalabras, paraDecir } from './grabar'

describe('montoEnPalabras', () => {
  it('dice los montos de cobranza como los diría una persona', () => {
    expect(montoEnPalabras(1_951_081)).toBe('un millón novecientos cincuenta y un mil ochenta y un pesos')
    expect(montoEnPalabras(975_541)).toBe('novecientos setenta y cinco mil quinientos cuarenta y un pesos')
    // «de pesos» solo cuando el millón es lo último que se dice.
    expect(montoEnPalabras(1_000_000)).toBe('un millón de pesos')
    expect(montoEnPalabras(100_000)).toBe('cien mil pesos')
    expect(montoEnPalabras(2_500_000)).toBe('dos millones quinientos mil pesos')
    expect(montoEnPalabras(3_000_000)).toBe('tres millones de pesos')
    expect(montoEnPalabras(21)).toBe('veintiún pesos')
    expect(montoEnPalabras(15)).toBe('quince pesos')
  })
})

describe('paraDecir', () => {
  /**
   * El defecto que motivó todo esto: el TTS lee `$ 1.951.081` como «un dólar
   * con noventa y cinco centavos» —toma el signo por dólares y los puntos por
   * decimales—. En una demo de cobranza colombiana eso es letal.
   */
  it('convierte los pesos a palabras en vez de dejarlos como cifra', () => {
    const dicho = paraDecir('Su saldo es de $ 1.951.081 y tiene 63 días de mora.')
    expect(dicho).toContain('un millón novecientos cincuenta y un mil ochenta y un pesos')
    expect(dicho).not.toContain('$')
  })

  /** Por teléfono el link va por WhatsApp; dictarlo arruina la toma. */
  it('no deja que se lea una URL', () => {
    const dicho = paraDecir('Acá le dejo el link: https://pagos.ejemplo.co/pagar/COB-abc-123')
    expect(dicho).not.toContain('http')
    expect(dicho).toContain('el link que le envié')
  })

  it('deja en paz lo que ya está en palabras', () => {
    const texto = 'Le propongo dos cuotas de novecientos setenta y cinco mil pesos.'
    expect(paraDecir(texto)).toBe(texto)
  })
})
