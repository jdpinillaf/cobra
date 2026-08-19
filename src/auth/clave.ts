import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Hash de contraseñas con scrypt.
 *
 * Sin librería, por la misma razón que el canal de WhatsApp no usa SDK: es una
 * primitiva de `node:crypto` y envolverla son treinta líneas. Pero es código de
 * seguridad escrito a mano, y eso impone tres reglas que conviene no relajar.
 *
 * **Sal aleatoria por clave.** Dos personas con la misma contraseña tienen
 * hashes distintos. Sin esto, una tabla precomputada las rompe a las dos de una
 * vez.
 *
 * **Los parámetros de costo viajan con el hash.** Subir el costo dentro de dos
 * años no puede invalidar las claves existentes: cada hash sabe con qué se
 * calculó y se verifica con eso.
 *
 * **Comparación en tiempo constante.** `===` sobre el hash corta en el primer
 * byte distinto y filtra, por tiempo, cuánto prefijo acertó quien prueba.
 *
 * No debe crecer hacia recuperación de contraseña ni SSO sin repensarlo: eso ya
 * no es una primitiva, es un protocolo.
 */

/**
 * `promisify` pierde la sobrecarga de `scrypt` que acepta opciones, así que la
 * envoltura va a mano y con el tipo puesto.
 */
function scryptAsync(
  clave: string,
  sal: Buffer,
  largo: number,
  opciones: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(clave, sal, largo, opciones, (error, derivado) =>
      error ? rechazar(error) : resolver(derivado),
    )
  })
}

/** Costo. N=16384 es el mínimo razonable hoy; queda escrito en cada hash. */
const N = 16_384
const R = 8
const P = 1
const LARGO_HASH = 32
const LARGO_SAL = 16

export async function hashearClave(clave: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL)
  const derivado = await scryptAsync(clave, sal, LARGO_HASH, {
    N,
    r: R,
    p: P,
    // scrypt necesita memoria ~128*N*r bytes; el default de Node es menor y
    // lanza. Se pide explícito para que no dependa de la versión.
    maxmem: 256 * N * R,
  })

  return ['scrypt', N, R, P, sal.toString('hex'), derivado.toString('hex')].join('$')
}

/**
 * Devuelve `false` ante cualquier problema, nunca lanza.
 *
 * Una fila mal migrada no puede tumbar el login de todo el mundo, y menos aún
 * puede dejar entrar. `false` es la única respuesta segura ante lo que no se
 * entiende.
 */
export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  try {
    const partes = guardado.split('$')
    if (partes.length !== 6) return false

    const [algoritmo, nTexto, rTexto, pTexto, salHex, hashHex] = partes
    if (algoritmo !== 'scrypt') return false

    const n = Number(nTexto)
    const r = Number(rTexto)
    const p = Number(pTexto)
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
    // Tope de costo: un `N` gigante en una fila manipulada sería una negación de
    // servicio contra el propio servidor en cada intento de login.
    if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false

    const esperado = Buffer.from(hashHex, 'hex')
    if (esperado.length === 0 || esperado.length * 2 !== hashHex.length) return false

    const sal = Buffer.from(salHex, 'hex')
    if (sal.length === 0 || sal.length * 2 !== salHex.length) return false

    const derivado = await scryptAsync(clave, sal, esperado.length, {
      N: n,
      r,
      p,
      maxmem: 256 * n * r,
    })

    // `timingSafeEqual` exige el mismo largo; el chequeo de arriba lo garantiza.
    return timingSafeEqual(derivado, esperado)
  } catch {
    return false
  }
}
