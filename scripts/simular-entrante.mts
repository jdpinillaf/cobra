#!/usr/bin/env tsx
/**
 * Manda un mensaje entrante como lo mandaría Meta.
 *
 * Arma el mismo payload que la Cloud API entrega, lo firma con el App Secret y
 * le pega al webhook real. **Sin atajos**: recorre la verificación de firma, la
 * resolución de tenant por `phone_number_id`, la idempotencia, la apertura de la
 * ventana de 24 h y la detección de opt-out. Lo que se ve acá es exactamente lo
 * que va a pasar el día que Meta llame de verdad, incluidos los bugs.
 *
 * Por eso no hay un botón en la consola que inyecte mensajes: un camino que solo
 * existe para la demo es el que después queda encendido donde no debe.
 *
 *   pnpm simular "+573266253427" "ya pagué ayer"
 *   pnpm simular "+573266253427" --imagen        (comprobante)
 *   pnpm simular "+573266253427" "no me contacten más"
 */
import { createHmac } from 'node:crypto'

/**
 * **No toca la base, a propósito.**
 *
 * PGlite es de un solo proceso: si este script abriera `.pglite` mientras
 * `pnpm dev` la tiene abierta, cada uno trabajaría sobre su propia copia y los
 * números que imprimiera serían mentira. El efecto se mira en la consola, que
 * es el mismo lugar donde lo va a mirar el cliente.
 */

const URL = process.env.URL_WEBHOOK ?? 'http://localhost:3000/api/whatsapp/webhook'
const SECRETO = process.env.META_APP_SECRET ?? 'secreto-local-de-pruebas'
/** El número de la empresa. `pnpm sembrar` lo deja en este valor. */
const NUMERO_EMPRESA = process.env.PHONE_NUMBER_ID ?? '10627'

const telefono = process.argv[2]
const argumento = process.argv[3] ?? 'hola, ¿cuánto debo?'

if (!telefono) {
  console.error('\n  uso: pnpm simular "<telefono E.164>" "<texto>"')
  console.error('       pnpm simular "<telefono>" --imagen\n')
  process.exit(1)
}

const esImagen = argumento === '--imagen'
const wamid = `wamid.SIM${Date.now()}`
const ahora = String(Math.floor(Date.now() / 1000))

const mensaje = esImagen
  ? {
      from: telefono.replace(/^\+/, ''),
      id: wamid,
      timestamp: ahora,
      type: 'image',
      image: {
        id: `media-sim-${Date.now()}`,
        mime_type: 'image/jpeg',
        sha256: 'simulado',
        caption: 'acá está el comprobante',
      },
    }
  : {
      from: telefono.replace(/^\+/, ''),
      id: wamid,
      timestamp: ahora,
      type: 'text',
      text: { body: argumento },
    }

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-simulada',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '573001112233', phone_number_id: NUMERO_EMPRESA },
            contacts: [{ wa_id: telefono.replace(/^\+/, ''), profile: { name: 'Deudor' } }],
            messages: [mensaje],
          },
        },
      ],
    },
  ],
}

const cuerpo = JSON.stringify(payload)
const firma = `sha256=${createHmac('sha256', SECRETO).update(cuerpo, 'utf8').digest('hex')}`

const r = await fetch(URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma },
  body: cuerpo,
})

console.log(`\n  → ${telefono}: ${esImagen ? '[imagen] acá está el comprobante' : argumento}`)
console.log(`  ← webhook respondió ${r.status}  (wamid ${wamid})`)

if (r.status === 401) {
  console.error('\n  Firma rechazada: META_APP_SECRET del script y del servidor no coinciden.\n')
  process.exit(1)
}
if (r.status !== 200) {
  console.error(`\n  El webhook devolvió ${r.status}. Mirá la consola de \`pnpm dev\`.\n`)
  process.exit(1)
}

console.log('  Miralo en http://localhost:3000/consola/conversaciones\n')
process.exit(0)
