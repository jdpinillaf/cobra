#!/usr/bin/env tsx
/**
 * Aplica las migraciones a una base real y deja el rol `app` listo.
 *
 * El rol no es opcional: `conTenant` baja a él para que RLS se evalúe de verdad,
 * y sin él la consola falla en el primer request. Que falle ruidoso está bien;
 * que el rol no exista y nadie se entere, no.
 *
 *   DATABASE_URL=postgres://... pnpm migrar
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { obtenerDb } from '../src/repo/conexion'

if (!process.env.DATABASE_URL) {
  console.error('\n  Falta DATABASE_URL. Este comando es para la base real.')
  console.error('  En local las migraciones se aplican solas al arrancar.\n')
  process.exit(1)
}

const db = await obtenerDb()
const dir = join(process.cwd(), 'supabase', 'migrations')

await db.exec(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
  archivo text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`)

// La bitácora de migraciones no es dato de nadie, pero `app` tenía permiso de
// escritura sobre ella por el GRANT de más abajo, que es sobre ALL TABLES. Un
// borrado ahí hace que la próxima corrida intente reaplicar un ALTER que ya
// existe, y la migración falla a mitad.
//
// RLS con una política que no deja ver nada: el dueño de la tabla la sigue
// leyendo —RLS no aplica al dueño— y `app` no la toca. Así además la bitácora
// cumple la misma regla que el resto y no hace falta exceptuarla del chequeo.
await db.exec(`
  ALTER TABLE migraciones_aplicadas ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS solo_el_migrador ON migraciones_aplicadas;
  CREATE POLICY solo_el_migrador ON migraciones_aplicadas USING (false);`)

const aplicadas = new Set(
  (await db.query<{ archivo: string }>('SELECT archivo FROM migraciones_aplicadas')).map(
    (f) => f.archivo,
  ),
)

let nuevas = 0
for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (aplicadas.has(archivo)) continue
  console.log(`  aplicando ${archivo}`)
  await db.exec(readFileSync(join(dir, archivo), 'utf8'))
  await db.query('INSERT INTO migraciones_aplicadas (archivo) VALUES ($1)', [archivo])
  nuevas += 1
}

// El rol que hace real el aislamiento. Sin BYPASSRLS, con permisos de datos y
// ninguno de esquema: si algún día una consulta se olvida del tenant, la base
// tiene que poder frenarla.
await db.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app NOLOGIN;
  END IF;
END $$;`)
await db.exec(`
  GRANT USAGE ON SCHEMA public TO app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;`)

// Y la membresía, que es lo que faltaba.
//
// `conTenant` hace `SET LOCAL ROLE app` para que RLS se evalúe de verdad, y en
// Postgres eso exige ser **miembro** del rol: tener los GRANT de datos no
// alcanza. Sin esto la base respondía «permission denied to set role "app"» y
// todo lo que pasa por `conTenant` —el webhook de WhatsApp, entero— fallaba.
//
// No se notaba porque el webhook devuelve 200 aunque adentro reviente, para no
// hacer que Meta reintente en bucle. O sea que habría fallado en silencio.
await db.exec(`GRANT app TO CURRENT_USER`)

const [rol] = await db.query<{ rolbypassrls: boolean }>(
  `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app'`,
)
const sinPolitica = await db.query<{ relname: string }>(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND (NOT c.relrowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = c.relname))`)

console.log(`\n  ${nuevas} migración(es) nueva(s)`)
console.log(`  rol app sin BYPASSRLS: ${rol && !rol.rolbypassrls ? 'sí' : 'NO — revisar'}`)
console.log(`  tablas sin RLS: ${sinPolitica.length === 0 ? 'ninguna' : sinPolitica.map((t) => t.relname).join(', ')}\n`)
process.exit(sinPolitica.length === 0 ? 0 : 1)
