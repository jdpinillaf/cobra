#!/usr/bin/env tsx
/**
 * Llama de verdad a un teléfono.
 *
 *   pnpm marcar "+573103673981"
 *
 * Necesita el servidor de voz corriendo y `VOZ_URL_PUBLICA` apuntando al túnel.
 * El TwiML va en línea en `calls.create`, así que Twilio no necesita alcanzar
 * ningún endpoint HTTP nuestro: solo el WebSocket.
 */
import { firmarVale } from '../src/voz/vale'
import { twimlConectarStream } from '../src/voz/protocolo-twilio'
import { configTwilioVozDesdeEntorno, TelefonistaTwilio } from '../src/voz/marcar'
import { obtenerDb, TENANT_DEV } from '../src/repo/conexion'
import { evaluar } from '../src/compliance/guard'
import { cargarContexto } from '../src/repo/cobranza/contexto'

const telefono = process.argv[2]
if (!telefono) {
  console.error('\n  uso: pnpm marcar "<telefono E.164>"\n')
  process.exit(1)
}

const publica = process.env.VOZ_URL_PUBLICA
if (!publica) {
  console.error('\n  falta VOZ_URL_PUBLICA: la URL del túnel (ngrok http 3300)\n')
  process.exit(1)
}

const config = configTwilioVozDesdeEntorno()
if (!config) {
  console.error('\n  faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_NUMERO_VOZ\n')
  process.exit(1)
}

const db = await obtenerDb()
const tenantId = process.env.TENANT_ID ?? TENANT_DEV

const [fila] = await db.query<{
  conversacion_id: string
  obligacion_id: string
  deudor_id: string
  nombre: string
}>(
  `SELECT c.id AS conversacion_id, c.obligacion_id, d.id AS deudor_id, d.nombre
     FROM deudores d
     JOIN conversaciones c ON c.tenant_id = d.tenant_id AND c.deudor_id = d.id
    WHERE d.tenant_id = $1 AND d.telefonos @> ARRAY[$2::text]
    ORDER BY c.ultimo_mensaje_en DESC NULLS LAST LIMIT 1`,
  [tenantId, telefono.replace(/\s/g, '')],
)
if (!fila) {
  console.error(`\n  no hay conversación para ${telefono} en este tenant\n`)
  process.exit(1)
}

/**
 * El guard **antes** de marcar, no después.
 *
 * Una llamada fuera de horario legal, un domingo o a alguien que pidió la baja
 * no se corrige colgando: ya sonó el teléfono. Y el bloqueo deja su fila, que
 * es lo que se le muestra a la SIC.
 */
const ctx = await cargarContexto(db, tenantId, fila.obligacion_id)
if (!ctx) {
  console.error('\n  no se pudo cargar el expediente\n')
  process.exit(1)
}
const decision = evaluar({
  ahora: new Date(),
  canal: 'voz',
  deudor: ctx.deudor,
  obligacion: ctx.obligacion,
  // `cargarContexto` ya los trae en la forma del dominio; volver a pedirlos al
  // repositorio devolvería la fila cruda, que no es la misma cosa.
  contactosDelDeudor: ctx.contactosDelDeudor,
})
if (!decision.permitido) {
  console.error(`\n  el guard bloqueó la llamada: ${decision.motivo}`)
  console.error(`  ${decision.detalle}\n`)
  process.exit(1)
}

const vale = firmarVale(
  {
    tenantId,
    conversacionId: fila.conversacion_id,
    obligacionId: fila.obligacion_id,
    deudorId: fila.deudor_id,
    telefono,
  },
  process.env.SESION_SECRETO ?? '',
)

const wss = `${publica.replace(/^https?:/, 'wss:').replace(/\/$/, '')}/media/${vale}`
const twiml = twimlConectarStream({ urlWs: wss })

console.log(`\n  llamando a ${fila.nombre} (${telefono}) desde ${config.desde}…`)
const llamada = await new TelefonistaTwilio(config).llamar({ a: telefono, twiml, grabar: true })
console.log(`  ${llamada.idProveedor} · ${llamada.estado}`)
console.log('  la transcripción aparece en /consola/llamadas cuando cuelgue\n')
process.exit(0)
