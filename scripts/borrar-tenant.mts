#!/usr/bin/env tsx
/**
 * Borra un tenant entero y todo lo que cuelga de él.
 *
 * Existe porque `pnpm sembrar` **agrega, no reemplaza**: los deudores coinciden
 * por documento, así que resembrar sobre datos viejos cuelga los mensajes
 * nuevos del hilo viejo y deja la conversación mezclada. Para que una demo
 * quede como se la probó hay que vaciar primero.
 *
 * Y es lo que dice `NOTAS-DESPLIEGUE.md` antes de cargar cartera real: borrar
 * el tenant de demostración en vez de mezclarlo con el del cliente.
 *
 * Irreversible. Se lleva por cascada la cartera, las conversaciones, los
 * mensajes, los acuerdos, los pagos **y los usuarios** de ese tenant. Por eso
 * pide el id completo y una confirmación aparte: un borrado que se dispara con
 * un flag suelto es el que se ejecuta sin querer.
 *
 *   pnpm tsx scripts/borrar-tenant.mts <uuid>           muestra qué borraría
 *   pnpm tsx scripts/borrar-tenant.mts <uuid> --si-borrar   lo borra
 */
import { obtenerDb } from '../src/repo/conexion'

const tenantId = process.argv[2]
const confirmado = process.argv.includes('--si-borrar')

if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error('\n  uso: pnpm tsx scripts/borrar-tenant.mts <uuid> [--si-borrar]\n')
  process.exit(1)
}

const db = await obtenerDb()

const [tenant] = await db.query<{ nombre: string; estado: string }>(
  'SELECT nombre, estado FROM tenants WHERE id = $1',
  [tenantId],
)
if (!tenant) {
  console.error(`\n  No existe el tenant ${tenantId}.\n`)
  process.exit(1)
}

const [conteo] = await db.query<Record<string, number>>(
  `SELECT
     (SELECT count(*) FROM deudores       WHERE tenant_id = $1)::int AS deudores,
     (SELECT count(*) FROM obligaciones   WHERE tenant_id = $1)::int AS obligaciones,
     (SELECT count(*) FROM conversaciones WHERE tenant_id = $1)::int AS conversaciones,
     (SELECT count(*) FROM contactos      WHERE tenant_id = $1)::int AS contactos,
     (SELECT count(*) FROM acuerdos       WHERE tenant_id = $1)::int AS acuerdos,
     (SELECT count(*) FROM pagos          WHERE tenant_id = $1)::int AS pagos,
     (SELECT count(*) FROM tenant_usuarios WHERE tenant_id = $1)::int AS usuarios`,
  [tenantId],
)

console.log(`\n  ${tenant.nombre}  [${tenant.estado}]`)
console.log(`  ${tenantId}\n`)
for (const [que, n] of Object.entries(conteo)) {
  console.log(`  ${que.padEnd(16)} ${n}`)
}

// Los pagos aprobados son plata que entró de verdad. Que exista uno no lo
// impide —puede ser un tenant de prueba— pero tiene que decirse fuerte.
const [reales] = await db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM pagos WHERE tenant_id = $1 AND estado = 'aprobado'`,
  [tenantId],
)
if (reales.n > 0) {
  console.log(`\n  ⚠ ${reales.n} pago(s) APROBADO(S). Eso es plata que entró.`)
}

if (!confirmado) {
  console.log('\n  Nada borrado. Agregá --si-borrar para hacerlo.\n')
  process.exit(0)
}

await db.query('DELETE FROM tenants WHERE id = $1', [tenantId])
console.log('\n  Borrado.\n')
process.exit(0)
