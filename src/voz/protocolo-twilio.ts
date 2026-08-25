/**
 * El protocolo de Twilio Media Streams, como funciones puras.
 *
 * Nada de esto abre un socket: se lee un string y se devuelve un string. Es lo
 * que permite probar el puente entero sin red, y lo que hace que un cambio de
 * nombre de campo en Twilio sea un `git commit` de 30 segundos en vez de una
 * sesión de depuración con una llamada real corriendo.
 *
 * **No hay transcodificación en ninguna parte.** Twilio manda mulaw 8 kHz en
 * base64 y Deepgram se configura con mulaw 8 kHz de entrada y de salida. Es la
 * razón por la que esto es un archivo y no una librería de DSP.
 */

export type EventoTwilio =
  | { evento: 'connected' }
  | { evento: 'start'; streamSid: string; callSid: string; parametros: Record<string, string> }
  | { evento: 'media'; streamSid: string; mulaw: Uint8Array; marcaMs: number }
  | { evento: 'mark'; streamSid: string; nombre: string }
  | { evento: 'stop'; streamSid: string }
  /** Nada se descarta callado: el crudo viaja para poder loguearlo. */
  | { evento: 'desconocido'; crudo: unknown }

interface TramaCruda {
  event?: string
  streamSid?: string
  start?: { callSid?: string; streamSid?: string; customParameters?: Record<string, string> }
  media?: { payload?: string; timestamp?: string }
  mark?: { name?: string }
}

export function leerEventoTwilio(texto: string): EventoTwilio {
  let t: TramaCruda
  try {
    t = JSON.parse(texto) as TramaCruda
  } catch {
    return { evento: 'desconocido', crudo: texto }
  }

  switch (t.event) {
    case 'connected':
      return { evento: 'connected' }

    case 'start':
      return {
        evento: 'start',
        streamSid: t.streamSid ?? t.start?.streamSid ?? '',
        callSid: t.start?.callSid ?? '',
        // El contexto viaja en `<Parameter>` dentro del TwiML y llega acá.
        // Resolverlo por número de teléfono sería ambiguo: dos deudores pueden
        // compartir celular, y un mismo deudor tener dos obligaciones.
        parametros: t.start?.customParameters ?? {},
      }

    case 'media':
      return {
        evento: 'media',
        streamSid: t.streamSid ?? '',
        mulaw: new Uint8Array(Buffer.from(t.media?.payload ?? '', 'base64')),
        marcaMs: Number(t.media?.timestamp ?? 0),
      }

    case 'mark':
      return { evento: 'mark', streamSid: t.streamSid ?? '', nombre: t.mark?.name ?? '' }

    case 'stop':
      return { evento: 'stop', streamSid: t.streamSid ?? '' }

    default:
      return { evento: 'desconocido', crudo: t }
  }
}

export function tramaMedia(streamSid: string, mulaw: Uint8Array): string {
  return JSON.stringify({
    event: 'media',
    streamSid,
    media: { payload: Buffer.from(mulaw).toString('base64') },
  })
}

/**
 * Vacía lo que Twilio tenga en cola de reproducción.
 *
 * Es la mitad del barge-in. La otra mitad —vaciar **nuestra** cola de salida—
 * va en el puente: sin eso, se limpia lo de Twilio y acto seguido se le vuelve
 * a empujar lo mismo, y el agente sigue hablando encima del deudor.
 */
export function tramaLimpiar(streamSid: string): string {
  return JSON.stringify({ event: 'clear', streamSid })
}

export function tramaMarca(streamSid: string, nombre: string): string {
  return JSON.stringify({ event: 'mark', streamSid, mark: { name: nombre } })
}

/**
 * Trozos de 20 ms.
 *
 * Twilio espera marcos de 160 bytes (8 kHz × 1 byte × 0,02 s) y Deepgram manda
 * bloques más grandes. Empujarlos enteros funciona, pero deja a Twilio con
 * segundos de audio en cola: cuando el deudor interrumpe, el `clear` tiene más
 * que descartar y el corte se oye. Trocear achica esa ventana.
 */
export function trocear(mulaw: Uint8Array, bytes = 160): Uint8Array[] {
  const trozos: Uint8Array[] = []
  for (let i = 0; i < mulaw.length; i += bytes) {
    trozos.push(mulaw.subarray(i, Math.min(i + bytes, mulaw.length)))
  }
  return trozos
}

const escapar = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * El TwiML que engancha la llamada al WebSocket.
 *
 * `<Connect>` y no `<Start>`: `<Start>` es unidireccional (nos deja oír pero no
 * hablar). Con `<Connect>` la llamada vive mientras viva el socket, que es
 * exactamente lo que se quiere de un agente conversacional.
 */
export function twimlConectarStream(params: {
  urlWs: string
  parametros?: Record<string, string>
}): string {
  const ps = Object.entries(params.parametros ?? {})
    .map(([k, v]) => `<Parameter name="${escapar(k)}" value="${escapar(v)}"/>`)
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Connect><Stream url="${escapar(params.urlWs)}">${ps}</Stream></Connect></Response>`
  )
}
