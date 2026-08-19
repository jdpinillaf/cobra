#!/usr/bin/env tsx
/**
 * Siembra una cartera de desarrollo.
 *
 * Usa `generarCartera` de la demo, que produce datos inventados con forma real:
 * distribución de mora cargada hacia la temprana, saldos de microcrédito
 * colombiano, y una fracción de deudores sin consentimiento o con teléfono
 * malo, porque ninguna base llega limpia.
 *
 *   pnpm sembrar            40 deudores
 *   pnpm sembrar 200        200
 */
import { generarCartera } from '../src/demo/seed'
import { TENANT_DEV, obtenerDb } from '../src/repo/conexion'
import { guardarCartera, listarObligaciones } from '../src/repo/cobranza/cartera'

const cantidad = Number(process.argv[2] ?? 40)
const fechaCorte = new Date().toISOString().slice(0, 10)

const db = await obtenerDb()

await db.query(
  `INSERT INTO tenants (id, nombre, nit, cuenta_ultimos4, cuenta_titular, capacidades, estado)
   VALUES ($1, 'Ferretería El Tornillo S.A.S.', '901234567-1', '4129',
           'FERRETERIA EL TORNILLO SAS', ARRAY['cobranza'], 'activo')
   ON CONFLICT (id) DO NOTHING`,
  [TENANT_DEV],
)
await db.query(
  `INSERT INTO tenant_cobranza (tenant_id, tier, cupo_mensajes_mes)
   VALUES ($1, 'mediana', 12000) ON CONFLICT (tenant_id) DO NOTHING`,
  [TENANT_DEV],
)

const cartera = generarCartera({ cantidad, fechaCorte, semilla: 42 })
const resumen = await guardarCartera(db, TENANT_DEV, cartera)
const obligaciones = await listarObligaciones(db, TENANT_DEV)

const porTramo = obligaciones.reduce<Record<string, number>>((acc, o) => {
  acc[o.tramo] = (acc[o.tramo] ?? 0) + 1
  return acc
}, {})
const saldo = obligaciones.reduce((s, o) => s + o.saldoTotal, 0)

console.log(`\nTenant  ${TENANT_DEV}`)
console.log(`Corte   ${fechaCorte}\n`)
console.log(`deudores nuevos      ${resumen.deudores}`)
console.log(`obligaciones nuevas  ${resumen.obligaciones}`)
console.log(`actualizadas         ${resumen.actualizadas}`)
console.log(`sin contactar        ${obligaciones.filter((o) => !o.contactable).length}`)
console.log(`\npor tramo`)
for (const [tramo, n] of Object.entries(porTramo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tramo.padEnd(12)} ${String(n).padStart(4)}`)
}
console.log(`\nsaldo total  ${new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(saldo)}\n`)
console.log('  pnpm dev  →  http://localhost:3000/consola/cartera\n')
process.exit(0)
