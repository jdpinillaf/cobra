#!/usr/bin/env tsx
/**
 * Una llamada del agente, simulada de punta a punta contra la base real.
 *
 * Es al canal de voz lo que `pnpm simular` es a WhatsApp: **escribe filas de
 * verdad y ejecuta las herramientas de verdad**, sin Twilio, sin Deepgram y sin
 * audio. Sale un acuerdo validado, un link de pago con referencia real, una
 * transcripción por turnos y un resumen — todo visible en `/consola/llamadas`.
 *
 *   pnpm llamar "+573001234567"                      guion determinista
 *   pnpm llamar "+573001234567" --guion escala
 *   pnpm llamar "+573001234567" --personaje regatea  dos modelos improvisando
 *
 * Guiones (deterministas, sin llave y sin costo): `cuotas` (cierra y manda
 * link) · `escala` (pide 12 cuotas) · `errado` (no es el titular) · `buzon`.
 *
 * Personajes (el deudor lo actúa un modelo, cada corrida sale distinta):
 * `negocia` · `regatea` · `no_es` · `ya_pago` · `pide_baja`. Cuestan tokens y
 * tardan; es la simulación que de verdad prueba el prompt.
 *
 * Exige `DATABASE_URL`: con PGlite, que es de un solo proceso, este script y
 * `pnpm dev` trabajarían sobre copias distintas y la consola no mostraría nada
 * de lo que pasó acá.
 */
import { llamadaSimulada } from '../src/voz/llamar'
import { GUIONES } from '../src/voz/simulado'
import { PERSONAJES } from '../src/voz/deudor-ia'
import { obtenerDb, TENANT_DEV } from '../src/repo/conexion'
import type { LimitesNegociacion } from '../src/domain/types'

const telefono = process.argv[2]
const i = process.argv.indexOf('--guion')
const guion = (i === -1 ? 'cuotas' : (process.argv[i + 1] ?? 'cuotas')) as keyof typeof GUIONES
const j = process.argv.indexOf('--personaje')
const personaje = j === -1 ? undefined : (process.argv[j + 1] as keyof typeof PERSONAJES)

if (!telefono) {
  console.error('\n  uso: pnpm llamar "<telefono E.164>" [--guion cuotas|escala|errado|buzon]\n')
  process.exit(1)
}
if (!GUIONES[guion]) {
  console.error(`\n  guion desconocido: ${guion}. Hay: ${Object.keys(GUIONES).join(', ')}\n`)
  process.exit(1)
}
if (personaje && !PERSONAJES[personaje]) {
  console.error(`\n  personaje desconocido: ${personaje}. Hay: ${Object.keys(PERSONAJES).join(', ')}\n`)
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('\n  falta DATABASE_URL. Ver la cabecera de este archivo.\n')
  process.exit(1)
}

const db = await obtenerDb()
const tenantId = process.env.TENANT_ID ?? TENANT_DEV

const [fila] = await db.query<{
  conversacion_id: string
  obligacion_id: string
  deudor_id: string
  nombre: string
  tramo: string
}>(
  `SELECT c.id AS conversacion_id, c.obligacion_id, d.id AS deudor_id, d.nombre, o.tramo
     FROM deudores d
     JOIN conversaciones c ON c.tenant_id = d.tenant_id AND c.deudor_id = d.id
     JOIN obligaciones o  ON o.tenant_id = d.tenant_id AND o.id = c.obligacion_id
    WHERE d.tenant_id = $1 AND d.telefonos @> ARRAY[$2::text]
    ORDER BY c.ultimo_mensaje_en DESC NULLS LAST, c.abierta_en DESC
    LIMIT 1`,
  [tenantId, telefono.replace(/\s/g, '')],
)

if (!fila) {
  console.error(`\n  no hay conversación abierta para ${telefono} en este tenant.`)
  console.error('  Corré `pnpm sembrar` o usá un teléfono de la cartera.\n')
  process.exit(1)
}

const [config] = await db.query<{
  nombre: string
  limites_por_tramo: Record<string, LimitesNegociacion> | null
}>(
  `SELECT t.nombre, c.limites_por_tramo
     FROM tenants t LEFT JOIN tenant_cobranza c ON c.tenant_id = t.id
    WHERE t.id = $1`,
  [tenantId],
)

const comoQuien = personaje
  ? `deudor actuado por el modelo · «${PERSONAJES[personaje].titulo}»`
  : `guion «${guion}»`
console.log(`\n  llamando a ${fila.nombre} (${telefono}) · ${comoQuien}…\n`)

const r = await llamadaSimulada(db, tenantId, {
  conversacionId: fila.conversacion_id,
  obligacionId: fila.obligacion_id,
  deudorId: fila.deudor_id,
  telefono,
  guion,
  personaje,
  clienteNombre: config?.nombre ?? 'la empresa',
  limitesPorTramo: config?.limites_por_tramo ?? {},
  urlBase: process.env.URL_PUBLICA_PAGOS ?? 'http://localhost:3000',
})

for (const t of r.turnos) {
  const quien = t.quien === 'agente' ? 'agente' : t.quien === 'deudor' ? 'deudor' : 'sistema'
  console.log(`  ${quien.padEnd(7)} ${t.texto}${t.interrumpido ? '  ⟨interrumpido⟩' : ''}`)
}

console.log('')
for (const a of r.acciones) {
  console.log(`  · ${a.nombre} → ${a.estado}`)
}

console.log(`\n  llamada ${r.llamadaId}`)
console.log('  se ve en /consola/llamadas\n')

process.exit(0)
