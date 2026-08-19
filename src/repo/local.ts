import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from './db'

/**
 * Postgres local, sin instalar nada.
 *
 * PGlite es Postgres compilado a WASM y corre dentro del mismo proceso de Next,
 * persistiendo a `.pglite/`. O sea que `pnpm dev` levanta con una base real,
 * migrada y sembrada, sin Docker, sin Supabase y sin cuenta de nadie.
 *
 * Importa que sea Postgres de verdad y no un doble: RLS, `set_config`,
 * `ON CONFLICT` y `xmax` son comportamientos del motor. Contra un simulacro,
 * todo lo que estamos construyendo pasaría en desarrollo y fallaría en
 * producción.
 *
 * Se cachea en `globalThis` por la misma razón que la demo: el hot reload de
 * Next reevalúa los módulos y sin eso cada cambio de archivo abriría una base
 * nueva y perdería los datos sembrados.
 */

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')
const RUTA_DATOS = join(process.cwd(), '.pglite')

interface Cache {
  db?: Promise<Db & { cerrar(): Promise<void> }>
}
const cache = globalThis as unknown as { __ponoxDb?: Cache }
cache.__ponoxDb ??= {}

async function abrir(): Promise<Db & { cerrar(): Promise<void> }> {
  const pg = await PGlite.create(RUTA_DATOS)

  const db: Db & { cerrar(): Promise<void> } = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<T>(sql, params as never[])
      return r.rows
    },
    async exec(sql: string) {
      await pg.exec(sql)
    },
    async transaccion<T>(fn: (tx: Db) => Promise<T>) {
      await pg.exec('BEGIN')
      try {
        const r = await fn(db)
        await pg.exec('COMMIT')
        return r
      } catch (e) {
        await pg.exec('ROLLBACK')
        throw e
      }
    },
    async cerrar() {
      await pg.close()
    },
  }

  await migrar(db)
  return db
}

/**
 * Aplica las migraciones que falten.
 *
 * Registro propio en `migraciones_aplicadas` en vez de recrear la base en cada
 * arranque: sembrar 40 deudores y trabajar sobre ellos toda una tarde no
 * debería perderse porque se agregó una migración.
 */
async function migrar(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
    archivo text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`)

  const aplicadas = new Set(
    (await db.query<{ archivo: string }>('SELECT archivo FROM migraciones_aplicadas')).map(
      (f) => f.archivo,
    ),
  )

  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(archivo)) continue
    await db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'))
    await db.query('INSERT INTO migraciones_aplicadas (archivo) VALUES ($1)', [archivo])
    console.log(`  migración aplicada: ${archivo}`)
  }

  // El rol que hace que RLS sea una red real y no decoración. En producción lo
  // crea el runbook de provisión; acá se crea solo.
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
      CREATE ROLE app NOLOGIN;
    END IF;
  END $$;`)
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;`)
}

export function dbLocal(): Promise<Db & { cerrar(): Promise<void> }> {
  cache.__ponoxDb!.db ??= abrir()
  return cache.__ponoxDb!.db
}
