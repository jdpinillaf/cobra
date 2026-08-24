import { describe, expect, it } from 'vitest'
import { hashearClave, verificarClave } from './clave'

/**
 * Hash de contraseñas.
 *
 * Es código de seguridad escrito a mano, así que los tests no prueban "que
 * funcione": prueban las propiedades que lo hacen seguro y que son fáciles de
 * romper sin darse cuenta al refactorizar.
 */

describe('hashearClave', () => {
  it('nunca produce el mismo hash dos veces para la misma clave', async () => {
    const a = await hashearClave('Contraseña Larga 123')
    const b = await hashearClave('Contraseña Larga 123')

    // Sal aleatoria. Sin esto, dos personas con la misma clave tienen el mismo
    // hash y una tabla precomputada las rompe a las dos de una vez.
    expect(a).not.toBe(b)
  })

  it('guarda los parámetros de costo junto al hash', async () => {
    const guardado = await hashearClave('lo que sea')

    // Sin los parámetros adentro, subir el costo el año que viene invalidaría
    // todas las claves existentes.
    expect(guardado).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
  })
})

describe('verificarClave', () => {
  it('acepta la clave correcta', async () => {
    const guardado = await hashearClave('Correcta 2026!')

    expect(await verificarClave('Correcta 2026!', guardado)).toBe(true)
  })

  it('rechaza la clave equivocada', async () => {
    const guardado = await hashearClave('Correcta 2026!')

    expect(await verificarClave('Correcta 2026', guardado)).toBe(false)
    expect(await verificarClave('', guardado)).toBe(false)
    expect(await verificarClave('correcta 2026!', guardado)).toBe(false)
  })

  it('distingue claves que difieren solo en el último carácter', async () => {
    // Si la comparación cortara temprano, esto seguiría pasando pero filtraría
    // información por tiempo. Se compara con timingSafeEqual.
    const guardado = await hashearClave('a'.repeat(64))

    expect(await verificarClave('a'.repeat(63) + 'b', guardado)).toBe(false)
  })

  it('devuelve false ante un hash guardado corrupto, sin lanzar', async () => {
    // Una fila mal migrada no puede tumbar el login de todo el mundo. Y menos
    // aún puede dejar entrar: `false` es la única respuesta segura.
    for (const basura of ['', 'scrypt$', 'scrypt$a$b$c$d$e', 'no-es-un-hash', '$$$$$']) {
      expect(await verificarClave('cualquiera', basura)).toBe(false)
    }
  })

  it('rechaza un algoritmo desconocido en vez de asumir el propio', async () => {
    // Si algún día se migra desde bcrypt, un hash bcrypt no debe validarse por
    // accidente contra scrypt ni al revés.
    expect(await verificarClave('x', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false)
    expect(await verificarClave('x', 'argon2$1$2$3$aa$bb')).toBe(false)
  })

  it('no acepta una clave vacía contra un hash de clave vacía por descuido', async () => {
    const guardado = await hashearClave('')

    // La clave vacía se hashea como cualquier otra: quien la valide de verdad
    // es el registro, no el verificador.
    expect(await verificarClave('', guardado)).toBe(true)
    expect(await verificarClave('x', guardado)).toBe(false)
  })
})
