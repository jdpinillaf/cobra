import { describe, expect, it } from 'vitest'
import { clasificar } from './clasificar'

describe('clasificar', () => {
  it.each([
    ['Hola Adriana, recibiste una transferencia de CARLOS por $100,000.00', 'ingreso'],
    ['Hola, recibiste una transferencia por $600,000 de ANA', 'ingreso'],
    ['Te consignaron $50,000 en tu cuenta de ahorros', 'ingreso'],
    ['Recibiste un pago por $80,000', 'ingreso'],
  ])('%s → ingreso', (texto, esperado) => {
    expect(clasificar(texto)).toBe(esperado)
  })

  it.each([
    ['Realizaste una transferencia por $100,000.00 desde tu cuenta *4129'],
    ['Pagaste $45,000 a EPM'],
    ['Compra aprobada por $32,000 en EXITO'],
    ['Retiro por $200,000 en cajero'],
  ])('%s → egreso', (texto) => {
    // Va antes que el ingreso en la lista: "realizaste una transferencia"
    // contiene "transferencia", y evaluarlo después haría entrar un pago
    // saliente como si fuera plata que llegó.
    expect(clasificar(texto)).toBe('egreso')
  })

  it.each([
    ['Tu clave fue cambiada exitosamente'],
    ['Detectamos un intento de acceso a tu cuenta'],
    ['Tu código de seguridad es 123456'],
  ])('%s → seguridad', (texto) => {
    expect(clasificar(texto)).toBe('seguridad')
  })

  it('lo que no reconoce es "otro", no "desconocido"', () => {
    // `desconocido` queda para el correo que ni siquiera se pudo leer. Este se
    // leyó bien y no habla de plata.
    expect(clasificar('Conoce nuestro nuevo crédito de libre inversión')).toBe('otro')
    expect(clasificar('')).toBe('otro')
  })

  it('no depende de los patrones del parser', () => {
    // Es a propósito y es lo que sostiene la recuperación: el día que
    // Bancolombia cambie la redacción, el parser deja de matchear pero esto
    // tiene que seguir diciendo "ingreso", porque es lo que decide si ese
    // correo se guarda para poder arreglar el parser.
    expect(clasificar('Hola! recibiste una transferencia — nuevo formato 2027')).toBe('ingreso')
  })
})
