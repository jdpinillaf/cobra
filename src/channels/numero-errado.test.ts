import { describe, expect, it } from 'vitest'
import { detectarNumeroErrado } from './numero-errado'

/**
 * El detector de "este no es mi número".
 *
 * El balance de errores es distinto al del opt-out y por eso vive aparte. Una
 * baja es del deudor, permanente e irreversible; esto es una **afirmación por
 * verificar**, porque el número puede estar bien y la persona estar esquivando.
 * La consecuencia es parar y pasarle el caso a un humano, no borrar al deudor.
 *
 * Eso fija el costo del error: un falso positivo cuesta una revisión, un falso
 * negativo cuesta seguir hostigando a un tercero que no debe nada — que es una
 * violación de habeas data, no una molestia.
 */

describe('detectarNumeroErrado', () => {
  it.each([
    'yo no soy, ese número está equivocado',
    'este no es mi número',
    'no es mi numero, se equivocaron',
    'tiene el número equivocado',
    'se equivocó de persona',
    'se equivocaron de número',
    'no conozco a esa persona',
    'acá no vive nadie con ese nombre',
    'ese no soy yo',
    'yo no soy el titular de ese crédito',
    'marcó mal, acá es una panadería',
    'NO SOY ESA PERSONA!!',
  ])('reconoce: %s', (texto) => {
    expect(detectarNumeroErrado(texto)).toBe(true)
  })

  it.each([
    'no soy capaz de pagar todo este mes',
    'no soy capaz, deme un plazo',
    'ya pagué, revisen bien por favor',
    'me sirve por cuotas?',
    'cuánto es lo que debo exactamente',
    'no me escriban más',
    'se equivocaron en el monto, yo debo menos',
    'creo que se equivocó de valor',
    '',
    '   ',
  ])('no se dispara con: %s', (texto) => {
    expect(detectarNumeroErrado(texto)).toBe(false)
  })

  it('no confunde la baja con el número errado', () => {
    // Son dos cosas distintas y se resuelven distinto: la baja revoca el
    // consentimiento para siempre; el número errado abre una revisión. Un
    // mensaje puede ser las dos, y entonces las dos aplican.
    expect(detectarNumeroErrado('no me escriban más')).toBe(false)
    expect(detectarNumeroErrado('no es mi número, no me escriban más')).toBe(true)
  })
})
