import type { Db } from './db'

/**
 * De dónde sale la base.
 *
 * Con `DATABASE_URL` va contra Postgres de verdad por `pg`. Sin ella, cae a
 * PGlite local. La regla es esa y no un flag: si alguien configuró una base,
 * quiere esa base, y olvidarse de un `NODE_ENV` no debería mandar los datos de
 * producción a un archivo en disco.
 *
 * El import de `pg` es dinámico a propósito: sin `DATABASE_URL` nunca se carga,
 * así que el desarrollo local no arrastra el driver ni pide credenciales.
 */

let memo: Promise<Db> | null = null

export function obtenerDb(): Promise<Db> {
  memo ??= (async () => {
    if (process.env.DATABASE_URL) {
      const { crearDb } = await import('./postgres')
      return crearDb()
    }
    const { dbLocal } = await import('./local')
    return dbLocal()
  })()
  return memo
}

/** Tenant de desarrollo. Lo siembra `pnpm sembrar` y lo lee la consola. */
export const TENANT_DEV = '11111111-1111-4111-8111-111111111111'
