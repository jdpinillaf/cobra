/**
 * Arma el audio de una llamada a partir de su transcripción.
 *
 * No es una llamada inventada: la conversación ya ocurrió —el agente real, con
 * las herramientas reales y los límites del cliente aplicados—, y lo único que
 * se simula es la telefonía. Sirve para mostrar en una reunión lo que suena por
 * el teléfono sin depender del wifi de la sala, de un túnel ni de una cuenta de
 * Twilio.
 *
 * Cada lado con su voz, y las dos de Deepgram: la del agente es **la misma**
 * que habla en producción, así que lo que se oye acá es lo que va a oír el
 * deudor.
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { TurnoVoz } from './agente'

const ejecutar = promisify(execFile)

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
const DIEZ_A_QUINCE = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince']
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function menorAMil(n: number): string {
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  const resto =
    r === 0 ? ''
    : r < 10 ? UNIDADES[r]
    : r < 16 ? DIEZ_A_QUINCE[r - 10]
    : r < 20 ? `dieci${UNIDADES[r - 10]}`
    : r < 30 ? (r === 20 ? 'veinte' : `veinti${UNIDADES[r - 20]}`)
    : r % 10 === 0 ? DECENAS[Math.floor(r / 10)]
    : `${DECENAS[Math.floor(r / 10)]} y ${UNIDADES[r % 10]}`
  return [CENTENAS[c], resto].filter(Boolean).join(' ')
}

/**
 * `1951081` → «un millón novecientos cincuenta y un mil ochenta y un pesos».
 *
 * Hace falta porque el TTS lee `$ 1.951.081` como «un dólar con noventa y cinco
 * centavos»: interpreta el signo como dólares y los puntos como decimales. En
 * una demo de cobranza colombiana eso es letal, y no se arregla en el prompt
 * porque el respaldo guionado escribe los montos con `cop()`.
 */
export function montoEnPalabras(pesos: number): string {
  if (pesos === 0) return 'cero pesos'
  const millones = Math.floor(pesos / 1_000_000)
  const miles = Math.floor((pesos % 1_000_000) / 1000)
  const resto = pesos % 1000

  const partes: string[] = []
  if (millones === 1) partes.push('un millón')
  else if (millones > 1) partes.push(`${menorAMil(millones)} millones`)
  if (miles === 1) partes.push('mil')
  else if (miles > 1) partes.push(`${menorAMil(miles)} mil`)
  if (resto > 0) partes.push(menorAMil(resto))

  const dicho = partes
    .join(' ')
    // «veintiún pesos», no «veintiun pesos»: la tilde cambia cómo lo pronuncia
    // el TTS, y sin ella suena a lectura de un robot.
    .replace(/\bveintiun\b/g, 'veintiún')

  // «un millón **de** pesos», pero «un millón novecientos mil pesos» sin `de`.
  // El `de` solo va cuando el millón es lo último que se dice.
  const soloMillones = miles === 0 && resto === 0 && millones > 0
  return soloMillones ? `${dicho} de pesos` : `${dicho} pesos`
}

/**
 * Deja el texto listo para que lo diga una voz.
 *
 * Solo toca lo que suena mal dicho en voz alta. Las URLs se quitan enteras: por
 * teléfono el agente nunca dicta un link —lo manda por WhatsApp— y leer una
 * dirección letra por letra arruina la toma.
 */
export function paraDecir(texto: string): string {
  return texto
    .replace(/\$\s?([\d.,]+)/g, (_, n: string) => {
      const limpio = Number(String(n).replace(/[.,]/g, ''))
      return Number.isFinite(limpio) && limpio > 0 ? montoEnPalabras(limpio) : _
    })
    .replace(/https?:\/\/\S+/g, 'el link que le envié')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface VocesLlamada {
  /** La del producto. Colombiana. */
  agente: string
  /** Distinta, y también colombiana o latina: dos voces iguales no se siguen. */
  deudor: string
}

export const VOCES_POR_DEFECTO: VocesLlamada = {
  agente: 'aura-2-celeste-es',
  deudor: 'aura-2-aquila-es',
}

/**
 * Cuánto silencio va entre turnos.
 *
 * Pegar las frases una detrás de otra suena a lectura, no a conversación. Medio
 * segundo antes de que el otro conteste es lo que hace que se oiga como dos
 * personas y no como un locutor.
 */
const PAUSA_MS = 600

async function sintetizar(
  texto: string,
  voz: string,
  apiKey: string,
): Promise<Uint8Array> {
  const r = await fetch(
    `https://api.deepgram.com/v1/speak?model=${voz}&encoding=linear16&sample_rate=24000`,
    {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto }),
    },
  )
  if (!r.ok) throw new Error(`TTS ${voz} respondió ${r.status}: ${await r.text()}`)
  return new Uint8Array(await r.arrayBuffer())
}

export interface OpcionesGrabacion {
  turnos: ReadonlyArray<Pick<TurnoVoz, 'quien' | 'texto'>>
  destino: string
  apiKey: string
  voces?: VocesLlamada
  /** Dos timbres antes del saludo. Es lo que hace que se lea como una llamada. */
  conTimbre?: boolean
}

export async function grabarLlamada(o: OpcionesGrabacion): Promise<string> {
  const voces = o.voces ?? VOCES_POR_DEFECTO
  const temporal = `${o.destino}.partes`
  await mkdir(temporal, { recursive: true })

  const piezas: string[] = []

  try {
    if (o.conTimbre) {
      /**
       * Timbre colombiano: 425 Hz, un segundo sonando y dos en silencio.
       * Se generan dos ciclos, que es lo que uno espera antes de que atiendan.
       */
      const timbre = join(temporal, '000-timbre.wav')
      await ejecutar('ffmpeg', [
        '-y', '-f', 'lavfi',
        '-i', 'sine=frequency=425:duration=6:sample_rate=24000',
        '-af', 'volume=0.18,' +
          "afade=t=out:st=1:d=0.05,afade=t=in:st=3:d=0.05," +
          "volume='if(between(t,1,3),0,if(between(t,4,6),0,1))':eval=frame",
        timbre,
      ])
      piezas.push(timbre)
    }

    let i = 0
    for (const turno of o.turnos) {
      if (turno.quien === 'sistema' || turno.texto.trim() === '') continue

      const voz = turno.quien === 'agente' ? voces.agente : voces.deudor
      const crudo = join(temporal, `${String(++i).padStart(3, '0')}-${turno.quien}.wav`)
      await writeFile(crudo, await sintetizar(paraDecir(turno.texto), voz, o.apiKey))
      piezas.push(crudo)

      const silencio = join(temporal, `${String(i).padStart(3, '0')}-pausa.wav`)
      await ejecutar('ffmpeg', [
        '-y', '-f', 'lavfi',
        '-i', `anullsrc=r=24000:cl=mono:d=${PAUSA_MS / 1000}`,
        silencio,
      ])
      piezas.push(silencio)
    }

    if (piezas.length === 0) throw new Error('la llamada no tiene turnos que grabar')

    /**
     * Solo el nombre del archivo, no la ruta.
     *
     * El demuxer `concat` resuelve lo que lee **relativo al archivo de lista**,
     * así que una ruta relativa al directorio de trabajo queda duplicada y no
     * abre nada. Como la lista vive junto a las piezas, el nombre alcanza.
     */
    const lista = join(temporal, 'lista.txt')
    await writeFile(
      lista,
      piezas.map((p) => `file '${basename(p).replace(/'/g, "'\\''")}'`).join('\n'),
    )

    /**
     * El filtro que lo hace sonar a teléfono.
     *
     * La banda telefónica va de 300 a 3400 Hz: sin recortarla, el audio suena a
     * estudio y nadie cree que salió de una llamada. Bajar a 8 kHz y volver a
     * subir agrega el mismo grano que agrega la red. La compresión imita el
     * control de nivel de la línea, que aplasta los picos.
     */
    await ejecutar('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', lista,
      '-af',
      'highpass=f=300,lowpass=f=3400,' +
        'aresample=8000,aresample=24000,' +
        'acompressor=threshold=0.08:ratio=4:attack=5:release=100,' +
        'volume=1.4',
      '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '24000', '-ac', '1',
      o.destino,
    ])

    return o.destino
  } finally {
    await rm(temporal, { recursive: true, force: true })
  }
}
