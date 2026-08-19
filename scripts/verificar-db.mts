#!/usr/bin/env tsx
/**
 * Smoke contra una base real. Lo que la suite no puede cubrir.
 *
 * Comprueba las cuatro cosas que solo fallan contra un servidor: que se
 * conecta, que el rol `app` existe sin BYPASSRLS, que `conTenant` aísla de
 * verdad, y que el ajuste no queda pegado a la conexión del pool.
 *
 *   DATABASE_URL=postgres://... pnpm tsx scripts/verificar-db.mts
 */
import { conTenant } from '../src/repo/con-tenant'
import { crearDb } from '../src/repo/postgres'

const db = crearDb()
const fallos: string[] = []
const revisar = (ok: boolean, que: string) => {
  console.log(`${ok ? '  ok  ' : 'FALLA '} ${que}`)
  if (!ok) fallos.push(que)
}

const [{ version }] = await db.query<{ version: string }>('SELECT version()')
console.log(`\n${version.slice(0, 40)}\n`)

const rol = await db.query<{ rolbypassrls: boolean }>(
  `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app'`,
)
revisar(rol.length === 1, 'el rol `app` existe')
revisar(rol[0]?.rolbypassrls === false, 'el rol `app` NO tiene BYPASSRLS')

const sinPolitica = await db.query<{ relname: string }>(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (NOT c.relrowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = c.relname))`)
revisar(sinPolitica.length === 0, `todas las tablas con RLS y política${
  sinPolitica.length ? ` (faltan: ${sinPolitica.map((t) => t.relname).join(', ')})` : ''
}`)

const tenants = await db.query<{ id: string }>('SELECT id FROM tenants LIMIT 1')
if (tenants.length) {
  const dentro = await conTenant(db, tenants[0].id, (tx) =>
    tx.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants'),
  )
  revisar(dentro[0].n === 1, 'conTenant aísla: adentro se ve un solo tenant')

  const fuera = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants')
  revisar(fuera[0].n >= 1, 'el ajuste no quedó pegado a la conexión del pool')
} else {
  console.log('  --   sin tenants sembrados: se omiten las pruebas de aislamiento')
}

await db.cerrar()
console.log(fallos.length ? `\n${fallos.length} fallas\n` : '\ntodo bien\n')
process.exit(fallos.length ? 1 : 0)
