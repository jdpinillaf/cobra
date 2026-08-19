import { Pool, type PoolClient } from 'pg'
import type { Db } from './db'

/**
 * El adaptador de producción.
 *
 * Deliberadamente delgado: toda la lógica vive en `src/repo/*` y se prueba
 * contra PGlite, que es Postgres de verdad. Acá solo está el cableado que un
 * servidor requiere y que un Postgres en proceso no tiene — pool, TLS y el
 * checkout de conexión para transacciones.
 *
 * **Esto no lo cubre la suite.** `pg` necesita un servidor escuchando y PGlite
 * no lo es, así que la verificación es el smoke de `scripts/verificar-db.mts`
 * contra un `DATABASE_URL` real. Preferí decirlo a simular un servidor y creer
 * que estaba probado.
 */

function envolver(ejecutar: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await ejecutar(sql, params)
      return r.rows as T[]
    },
    async exec(sql: string) {
      await ejecutar(sql, [])
    },
    async transaccion() {
      // Anidar transacciones necesitaría savepoints, y nada en este sistema lo
      // pide. Fallar es mejor que abrir una transacción que no lo es.
      throw new Error('transaccion anidada: no soportado')
    },
  }
}

export interface OpcionesDb {
  connectionString?: string
  /** Supabase exige TLS. En local contra un Postgres pelado, no. */
  ssl?: boolean
  max?: number
}

export function crearDb(opciones: OpcionesDb = {}): Db & { cerrar(): Promise<void> } {
  const connectionString = opciones.connectionString ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('falta DATABASE_URL')
  }

  const pool = new Pool({
    connectionString,
    // `rejectUnauthorized: false` porque Supabase presenta un certificado de su
    // propia CA. Es TLS igual; lo que no se valida es la cadena.
    ssl: (opciones.ssl ?? connectionString.includes('supabase')) ? { rejectUnauthorized: false } : undefined,
    // Fluid Compute reutiliza instancias entre requests concurrentes, así que
    // un pool chico por instancia alcanza y evita agotar el límite de Supabase.
    max: opciones.max ?? 5,
  })

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params as never[])
      return r.rows as T[]
    },
    async exec(sql: string) {
      await pool.query(sql)
    },
    async transaccion<T>(fn: (tx: Db) => Promise<T>) {
      // El checkout es el punto de todo esto: sin una conexión reservada, el
      // BEGIN y el SELECT que le sigue salen por conexiones distintas.
      const conexion: PoolClient = await pool.connect()
      const tx = envolver((sql, params) => conexion.query(sql, params as never[]))
      try {
        await conexion.query('BEGIN')
        const r = await fn(tx)
        await conexion.query('COMMIT')
        return r
      } catch (e) {
        await conexion.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        conexion.release()
      }
    },
    async cerrar() {
      await pool.end()
    },
  }
}
