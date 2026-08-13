import { describe, expect, it } from 'vitest'
import type { Consentimiento } from '@/domain/types'
import { aplicarOptOut, detectarOptOut } from './opt-out'

describe('detectarOptOut', () => {
  it.each([
    'BAJA',
    'baja',
    'Baja!!',
    'STOP',
    'stop por favor',
    'No me contacten más',
    'no me vuelvan a escribir',
    'NO MAS MENSAJES',
    'quiero darme de baja',
    'dejen de molestar',
    'no autorizo el tratamiento de mis datos',
    'revoco la autorización',
    'eliminar mis datos',
  ])('reconoce "%s" como baja', (texto) => {
    expect(detectarOptOut(texto)).toBe(true)
  })

  it('reconoce la baja aunque venga sin acentos ni mayúsculas', () => {
    // Se escribe desde el celular: no hay acentos ni puntuación consistente.
    expect(detectarOptOut('no me contacten')).toBe(true)
    expect(detectarOptOut('NO ME CONTACTEN.')).toBe(true)
  })

  it.each([
    'ya cancelé la cuota',
    'Cancelé el crédito la semana pasada',
    'voy a cancelar mañana',
    '¿puedo pagar en cuotas?',
    'no puedo pagar este mes',
    'no tengo plata ahorita',
    'me quedé sin trabajo',
    '',
    '   ',
  ])('no confunde "%s" con una baja', (texto) => {
    expect(detectarOptOut(texto)).toBe(false)
  })

  it('"cancelar" nunca es una baja: en Colombia significa pagar', () => {
    // Tratarla como opt-out apagaría la cadencia justo del deudor que paga.
    expect(detectarOptOut('cancelar')).toBe(false)
    expect(detectarOptOut('ya cancelé')).toBe(false)
  })
})

describe('aplicarOptOut', () => {
  const base: Consentimiento = {
    otorgado: true,
    fuente: 'pagare',
    fecha: '2026-01-10T10:00:00-05:00',
    revocadoEn: null,
  }

  it('escribe la fecha de revocación', () => {
    const r = aplicarOptOut(base, '2026-08-11T10:00:00-05:00')
    expect(r.revocadoEn).toBe('2026-08-11T10:00:00-05:00')
  })

  it('conserva la primera revocación: es la que vale ante la SIC', () => {
    const primera = aplicarOptOut(base, '2026-08-11T10:00:00-05:00')
    const segunda = aplicarOptOut(primera, '2026-09-01T10:00:00-05:00')
    expect(segunda.revocadoEn).toBe('2026-08-11T10:00:00-05:00')
  })

  it('no toca el resto del consentimiento', () => {
    const r = aplicarOptOut(base, '2026-08-11T10:00:00-05:00')
    expect(r).toMatchObject({ otorgado: true, fuente: 'pagare', fecha: base.fecha })
  })
})
