#!/usr/bin/env tsx
/**
 * Prueba el socket real de Deepgram sin gastar una llamada.
 *
 * Sintetiza lo que diría el deudor con el TTS de Deepgram —mulaw 8 kHz, el
 * mismo formato que habla Twilio—, se lo mete al puente por donde entraría el
 * audio del teléfono, y registra **todo** lo que vuelve. Es donde se descubre
 * que un campo del contrato no se llama como dice la documentación, que es el
 * modo de falla que en una llamada real deja al agente mudo con el cliente
 * escuchando.
 *
 * Corre contra el `PuertoAgente` de verdad: las herramientas se ejecutan y las
 * validaciones aplican. Lo único que no hay es teléfono.
 *
 *   pnpm voz-probar "+573001234567"
 *   pnpm voz-probar "+573001234567" --frases "no puedo pagar todo|listo, hagámosle"
 */
import { AgenteDeepgram, configDeepgramDesdeEntorno } from '../src/voz/deepgram'
import { abrirPuente, type DiarioDeLlamada, type SalidaTwilio } from '../src/voz/puente'
import { declararFunciones } from '../src/voz/funciones'
import { crearHerramientas, type ContextoHerramientas } from '../src/agent/herramientas'
import { abrirPuerto } from '../src/agent/puerto-pg'
import { limitesDelTramo } from '../src/agent/cerebro'
import { construirPrompt } from '../src/agent/prompt'
import { enBogota } from '../src/compliance/reloj-bogota'
import { saludoDe } from '../src/voz/llamar'
import { obtenerDb, TENANT_DEV } from '../src/repo/conexion'
import type { LimitesNegociacion } from '../src/domain/types'

const telefono = process.argv[2]
const i = process.argv.indexOf('--frases')
const FRASES = (
  i === -1
    ? 'Buenas, ¿de qué se trata?|No tengo cómo pagar todo de una|Listo, hagámosle así'
    : (process.argv[i + 1] ?? '')
).split('|').map((f) => f.trim()).filter(Boolean)

if (!telefono) {
  console.error('\n  uso: pnpm voz-probar "<telefono E.164>" [--frases "a|b|c"]\n')
  process.exit(1)
}

const config = configDeepgramDesdeEntorno()
if (!config) {
  console.error('\n  falta DEEPGRAM_API_KEY\n')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('\n  falta DATABASE_URL\n')
  process.exit(1)
}

/**
 * El TTS devuelve un WAV; Twilio manda mulaw pelado. Se corta la cabecera
 * buscando el trozo `data`, porque su tamaño no siempre es 44 bytes.
 */
async function sintetizar(texto: string): Promise<Uint8Array> {
  const r = await fetch(
    `https://api.deepgram.com/v1/speak?model=${config!.voz}&encoding=mulaw&sample_rate=8000`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${config!.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texto }),
    },
  )
  if (!r.ok) throw new Error(`TTS respondió ${r.status}: ${await r.text()}`)

  const bytes = new Uint8Array(await r.arrayBuffer())
  const marca = Buffer.from('data')
  const donde = Buffer.from(bytes).indexOf(marca)
  return donde === -1 ? bytes : bytes.subarray(donde + 8)
}

const db = await obtenerDb()
const tenantId = process.env.TENANT_ID ?? TENANT_DEV

const [fila] = await db.query<{ conversacion_id: string; obligacion_id: string; nombre: string }>(
  `SELECT c.id AS conversacion_id, c.obligacion_id, d.nombre
     FROM deudores d
     JOIN conversaciones c ON c.tenant_id = d.tenant_id AND c.deudor_id = d.id
    WHERE d.tenant_id = $1 AND d.telefonos @> ARRAY[$2::text]
    ORDER BY c.ultimo_mensaje_en DESC NULLS LAST LIMIT 1`,
  [tenantId, telefono.replace(/\s/g, '')],
)
if (!fila) {
  console.error(`\n  no hay conversación para ${telefono}\n`)
  process.exit(1)
}

const [cliente] = await db.query<{ nombre: string; limites_por_tramo: Record<string, LimitesNegociacion> | null }>(
  `SELECT t.nombre, c.limites_por_tramo FROM tenants t
     LEFT JOIN tenant_cobranza c ON c.tenant_id = t.id WHERE t.id = $1`,
  [tenantId],
)

const puerto = await abrirPuerto(db, tenantId, {
  conversacionId: fila.conversacion_id,
  obligacionId: fila.obligacion_id,
})
if (!puerto) throw new Error('no se pudo abrir el puerto')

const limites = limitesDelTramo(cliente?.limites_por_tramo ?? {}, puerto.obligacion.tramo)
const fechaHoy = enBogota(new Date()).fecha
const ctx: ContextoHerramientas = {
  puerto,
  limites,
  fechaHoy,
  urlBase: process.env.URL_PUBLICA_PAGOS ?? 'http://localhost:3000',
  canal: 'voz',
}
const herramientas = crearHerramientas(ctx)

let bytesDeVuelta = 0
const salida: SalidaTwilio = {
  enviarMedia: (m) => { bytesDeVuelta += m.length },
  limpiar: () => console.log('  ⟨barge-in: se limpió la cola de Twilio⟩'),
  colgar: () => console.log('  ⟨colgar⟩'),
}

const diario: DiarioDeLlamada = {
  async anotarTurno(t) {
    const quien = t.quien === 'agente' ? 'AGENTE' : t.quien === 'deudor' ? 'DEUDOR' : 'sistema'
    console.log(`  ${quien.padEnd(7)} ${t.texto}`)
  },
  async marcarInterrumpido(indice) { console.log(`  ⟨turno ${indice} interrumpido⟩`) },
  async anotarAccion(a) {
    console.log(`  · ${a.nombre} → ${a.estado} (${a.latenciaMs} ms)  ${JSON.stringify(a.argumentos)}`)
  },
  async cerrar(c) {
    console.log(`\n  cierre: ${c.motivo} · ${c.duracionSeg}s · ${c.resumen.resultado}`)
    console.log(`  ${c.resumen.texto}`)
  },
}

console.log(`\n  ${cliente?.nombre} → ${fila.nombre}`)
console.log(`  voz ${config.voz} · escucha ${config.modeloEscucha} · piensa ${config.modeloPensar}\n`)

const puente = await abrirPuente({
  agente: new AgenteDeepgram(config),
  salida,
  diario,
  herramientas,
  puerto,
  funciones: await declararFunciones(herramientas),
  prompt: construirPrompt({
    cliente: { nombre: cliente?.nombre ?? 'la empresa' },
    deudor: puerto.deudor,
    obligacion: puerto.obligacion,
    limites,
    fechaHoy,
    canal: 'voz',
  }),
  saludo: saludoDe(cliente?.nombre ?? 'la empresa', puerto.deudor.nombre),
  // Sin teléfono no hay buzón que detectar, y el guardia cortaría la prueba.
  esperaDeVozMs: 600_000,
})

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Silencio en mulaw. `0xFF` es el cero de la codificación.
 *
 * Hace falta porque **Deepgram corta el socket si deja de llegar audio**
 * («We did not receive audio within our timeout»). En una llamada real Twilio
 * manda audio sin parar, incluso cuando nadie habla; acá hay que imitarlo o la
 * prueba se muere mientras uno espera a que el agente termine su frase.
 */
const SILENCIO = new Uint8Array(160).fill(0xff)

let hablando = false
const latido = setInterval(() => {
  if (!hablando) puente.recibirAudio(SILENCIO)
}, 20)

/** Marcos de 20 ms en tiempo real: mandarlos de golpe rompe el endpointing. */
async function hablar(mulaw: Uint8Array): Promise<void> {
  hablando = true
  for (let i = 0; i < mulaw.length; i += 160) {
    puente.recibirAudio(mulaw.subarray(i, Math.min(i + 160, mulaw.length)))
    await dormir(20)
  }
  hablando = false
}

// El saludo del agente sale primero; se le da aire antes de interrumpirlo.
await dormir(6_000)

for (const frase of FRASES) {
  console.log(`\n  ⟨sintetizando: «${frase}»⟩`)
  await hablar(await sintetizar(frase))
  // Lo que el agente tarda en pensar, llamar herramientas y contestar.
  await dormir(14_000)
}

await dormir(3_000)
clearInterval(latido)
await puente.terminar('prueba_terminada')

console.log(`\n  audio del agente: ${(bytesDeVuelta / 8000).toFixed(1)}s`)
console.log(`  turnos: ${puente.turnos.length} · acciones: ${puente.acciones.length}\n`)
process.exit(0)
