#!/usr/bin/env tsx
/**
 * El servidor que atiende las llamadas.
 *
 *   ngrok http 3300           # en otra terminal
 *   VOZ_URL_PUBLICA=https://xxxx.ngrok.app pnpm voz-servidor
 *
 * Exige `DATABASE_URL`: PGlite es de un solo proceso, así que con la base local
 * este servidor y `pnpm dev` trabajarían sobre copias distintas y la consola no
 * mostraría nada de lo que pasó en la llamada.
 */
import { crearServidorVoz } from '../src/voz/servidor'
import { obtenerDb } from '../src/repo/conexion'

const PUERTO = Number(process.env.VOZ_PUERTO ?? 3300)

if (!process.env.DATABASE_URL) {
  console.error('\n  falta DATABASE_URL\n')
  process.exit(1)
}
if (!process.env.SESION_SECRETO) {
  console.error('\n  falta SESION_SECRETO: es con lo que se firma el vale del socket\n')
  process.exit(1)
}
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('\n  falta DEEPGRAM_API_KEY\n')
  process.exit(1)
}

const db = await obtenerDb()
crearServidorVoz({
  puerto: PUERTO,
  secretoVale: process.env.SESION_SECRETO,
  db,
  urlBase: process.env.URL_PUBLICA_PAGOS ?? 'http://localhost:3000',
})

console.log(`\n  servidor de voz en :${PUERTO}`)
console.log(`  salud    http://localhost:${PUERTO}/salud`)
console.log(`  pública  ${process.env.VOZ_URL_PUBLICA ?? '(sin VOZ_URL_PUBLICA: pnpm marcar no va a poder armar el wss)'}\n`)
