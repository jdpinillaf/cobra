import { describe, expect, it } from 'vitest'
import { parseMonto } from './monto'

/**
 * La tabla es obligatoria y va desde el primer commit.
 *
 * No porque el código sea difícil, sino porque el modo de falla es invisible: un
 * monto mal leído no rompe nada, cruza contra el comprobante equivocado o no
 * cruza nunca, y eso se descubre con el cliente furioso.
 */

describe('parseMonto', () => {
  it.each([
    // Las dos plantillas reales de Bancolombia.
    ['100,000.00', 10_000_000, 'plantilla llaves: coma de miles y centavos'],
    ['600,000', 60_000_000, 'plantilla transferencia: coma de miles, sin centavos'],

    // Notación con punto de miles, que aparece cuando el correo llega en es-CO.
    ['1.500.000', 150_000_000, 'punto de miles, dos veces'],
    ['12.345.678,90', 1_234_567_890, 'punto de miles y coma decimal'],

    // El caso que rompía la versión que detectaba el formato por la coma.
    ['500.00', 50_000, 'centavos sin separador de miles'],
    ['1,000.00', 100_000, 'mil exacto con centavos'],

    ['900', 90_000, 'sin separadores'],
    ['0.50', 50, 'menos de un peso'],
    ['0.5', 50, 'un solo dígito de centavos'],
    ['0', 0, 'cero'],
    ['$100,000.00', 10_000_000, 'con el signo pegado'],
    ['  600,000  ', 60_000_000, 'con espacios alrededor'],

    // Notación es-CO, por si el correo llega alguna vez en ese formato.
    ['1.234,56', 123_456, 'punto de miles y coma decimal, dos decimales'],
    ['1,00', 100, 'coma decimal con dos dígitos: un peso, no mil'],
  ])('%s → %i centavos (%s)', (crudo, esperado) => {
    expect(parseMonto(crudo)).toBe(esperado)
  })

  it.each([
    ['abc', 'texto'],
    ['', 'vacío'],
    ['-500', 'negativo: un aviso de ingreso nunca lo es'],
    ['1e5', 'notación científica'],
    ['1.2.3', 'separadores sin tres dígitos detrás'],
    ['100,00,00', 'dos grupos de dos dígitos'],
  ])('lanza ante %s (%s)', (crudo) => {
    expect(() => parseMonto(crudo)).toThrow()
  })

  it.each([
    // Un separador seguido de exactamente tres dígitos es de miles, aunque sea
    // el último. `"1.234,567"` no existe en pesos —el peso no tiene tres
    // decimales— así que la lectura buena es 1.234.567, no 1.234 con cola.
    ['1.234,567', 123_456_700, 'separadores mezclados con tres dígitos al final'],
    ['100.000.00', 10_000_000, 'punto de miles y punto decimal en el mismo monto'],
  ])('%s → %i centavos, resolviendo la ambigüedad hacia miles (%s)', (crudo, esperado) => {
    expect(parseMonto(crudo)).toBe(esperado)
  })

  it('lanza en vez de devolver NaN', () => {
    // `parseFloat` devolvería NaN, y NaN se inserta como cero o como null según
    // el driver. Un monto en cero cruza contra cualquier cosa.
    let resultado: number | null = null
    try {
      resultado = parseMonto('no es un monto')
    } catch {
      resultado = null
    }
    expect(resultado).toBeNull()
  })

  it('lanza ante un monto que ya no cabe en un entero seguro', () => {
    expect(() => parseMonto('99.999.999.999.999.999')).toThrow(/rango/i)
  })

  it('nunca devuelve un no-entero', () => {
    for (const crudo of ['100,000.00', '0.50', '1.500.000', '900', '0.5']) {
      expect(Number.isInteger(parseMonto(crudo))).toBe(true)
    }
  })
})
