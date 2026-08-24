import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { obtenerDb } from '@/repo/conexion'
import { resolverSesion, type Sesion } from './sesion'

/**
 * Quién está pidiendo, en server components y en route handlers.
 *
 * `cookies()` de `next/headers` funciona igual en los dos, así que no hace falta
 * middleware. Y evitarlo tiene una razón concreta además de la simplicidad: el
 * middleware corre en el runtime Edge, donde `node:crypto` no está, y habría que
 * mantener dos implementaciones del mismo HMAC. Dos implementaciones de una
 * verificación de firma es una de más.
 *
 * **No hay atajo de desarrollo.** Un bypass "solo en dev" es el tipo de cosa que
 * termina en producción el día que alguien se equivoca con una variable de
 * entorno. `pnpm sembrar` crea un usuario con clave conocida y se entra igual
 * que en producción.
 */

export const COOKIE_SESION = 'ponox_sesion'

export async function sesionActual(): Promise<Sesion | null> {
  const cookie = (await cookies()).get(COOKIE_SESION)?.value
  if (!cookie) return null

  return resolverSesion(await obtenerDb(), cookie)
}

/** Para páginas: sin sesión, al login. */
export async function requerirSesion(): Promise<Sesion> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/consola/entrar')
  return sesion
}
