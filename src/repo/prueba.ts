import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from './db'

/**
 * Postgres de verdad dentro de vitest.
 *
 * PGlite es Postgres compilado a WASM y corre en proceso: no hay Docker, no hay
 * servicio que levantar, y la suite sigue tardando lo mismo. Importa que sea
 * Postgres real y no un doble, porque lo que se está probando es RLS, y RLS es
 * un comportamiento del motor. Contra un doble el test diría que sí siempre.
 *
 * Las migraciones se aplican desde `supabase/migrations` tal como van a correr
 * en producción. Si una migración está rota, la suite se cae acá y no el día
 * del deploy.
 */

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')

export interface BaseDePrueba {
  /** Conexión superusuario: el equivalente de la service key. Ignora RLS. */
  db: Db
  sembrarTenant(id: string, nombre: string): Promise<void>
  /**
   * Corre SQL con el rol de aplicación y el tenant fijado en la sesión, que es
   * la única forma de que RLS realmente se aplique.
   */
  comoTenant<T = Record<string, unknown>>(tenantId: string, sql: string): Promise<T[]>
  /**
   * Vacía todo sin recrear la base.
   *
   * Levantar PGlite y aplicar migraciones cuesta ~700 ms, así que hacerlo por
   * test hacía que un solo archivo se llevara el 40% de la suite. Una base por
   * archivo y `TRUNCATE` entre tests da el mismo aislamiento por una fracción
   * del tiempo, porque todo cuelga de `tenants` con ON DELETE CASCADE.
   */
  limpiar(): Promise<void>
  cerrar(): Promise<void>
}

export async function crearBaseDePrueba(): Promise<BaseDePrueba> {
  const pg = await PGlite.create()

  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<T>(sql, params as never[])
      return r.rows
    },
    async exec(sql: string) {
      await pg.exec(sql)
    },
  }

  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'))
  }

  // El rol de aplicación. Un superusuario saltea RLS, así que sin esto el test
  // de aislamiento pasaría sin probar nada.
  await pg.exec(`
    CREATE ROLE app NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;
  `)

  return {
    db,
    async sembrarTenant(id, nombre) {
      await db.query(
        `INSERT INTO tenants (id, nombre, cuenta_ultimos4, email_alias, capacidades, estado)
         VALUES ($1, $2, '4129', $3, ARRAY['conciliacion'], 'activo')`,
        [id, nombre, `alias-${id.slice(0, 8)}@in.ponox.co`],
      )
    },
    async comoTenant<T>(tenantId: string, sql: string) {
      await pg.exec(`SET ROLE app; SET app.tenant_id = '${tenantId}';`)
      try {
        const r = await pg.query<T>(sql)
        return r.rows
      } finally {
        await pg.exec(`RESET ROLE; RESET app.tenant_id;`)
      }
    },
    async limpiar() {
      await pg.exec('TRUNCATE tenants CASCADE')
    },
    async cerrar() {
      await pg.close()
    },
  }
}
