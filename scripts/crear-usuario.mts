#!/usr/bin/env tsx
/**
 * Crea o actualiza un usuario de la consola.
 *
 * Contra la base que diga `DATABASE_URL`; sin ella, contra la local. Es el mismo
 * camino en los dos lados: no hay una versión "de desarrollo" del alta de
 * usuarios, porque un alta con atajo es la que después deja una cuenta con clave
 * conocida en producción.
 *
 *   pnpm crear-usuario ana@empresa.co "Ana Ruiz" admin
 *   DATABASE_URL=postgres://... pnpm crear-usuario ana@empresa.co "Ana Ruiz"
 *
 * La clave se genera sola y se imprime una vez. No se guarda en ningún lado en
 * claro: si se pierde, se corre el comando de nuevo y se genera otra.
 */
import { randomBytes } from 'node:crypto'
import { hashearClave } from '../src/auth/clave'
import { obtenerDb, TENANT_DEV } from '../src/repo/conexion'

const email = process.argv[2]
const nombre = process.argv[3] ?? email
const rol = process.argv[4] === 'admin' ? 'admin' : 'operador'
const tenantId = process.env.TENANT_ID ?? TENANT_DEV

if (!email || !email.includes('@')) {
  console.error('\n  uso: pnpm crear-usuario <email> "<nombre>" [admin|operador]\n')
  process.exit(1)
}

const db = await obtenerDb()

const [tenant] = await db.query<{ id: string; nombre: string }>(
  `SELECT id, nombre FROM tenants WHERE id = $1`,
  [tenantId],
)
if (!tenant) {
  console.error(`\n  No existe el cliente ${tenantId}. Corré \`pnpm sembrar\` primero.\n`)
  process.exit(1)
}

// Sílabas legibles: una clave que alguien va a tipear una vez desde un WhatsApp
// no debería tener caracteres que se confundan al leerlos en voz alta.
const SILABAS = ['ma', 'te', 'ri', 'so', 'lu', 'na', 'pe', 'do', 'ca', 'vi', 'to', 'ra']
const clave = `${Array.from({ length: 4 }, () => SILABAS[randomBytes(1)[0] % SILABAS.length]).join('')}-${randomBytes(2).toString('hex')}`

const [usuario] = await db.query<{ id: string; creado: boolean }>(
  `INSERT INTO tenant_usuarios (tenant_id, email, nombre, hash_clave, rol, activo)
   VALUES ($1, lower($2), $3, $4, $5, true)
   ON CONFLICT (tenant_id, email) DO UPDATE
     SET nombre = EXCLUDED.nombre, hash_clave = EXCLUDED.hash_clave,
         rol = EXCLUDED.rol, activo = true
   RETURNING id, (xmax = 0) AS creado`,
  [tenantId, email, nombre, await hashearClave(clave), rol],
)

console.log(`\n  ${usuario.creado ? 'Usuario creado' : 'Usuario actualizado'} en ${tenant.nombre}\n`)
console.log(`  correo    ${email.toLowerCase()}`)
console.log(`  clave     ${clave}`)
console.log(`  rol       ${rol}`)
console.log(`\n  La clave se muestra una sola vez. Si se pierde, corré el comando de nuevo.\n`)
process.exit(0)
