/**
 * El agente de voz de Deepgram.
 *
 * Un solo WebSocket hace escuchar, pensar, hablar, turn-taking y barge-in. Lo
 * que **no** hace es decidir: las funciones van sin `endpoint`, así que el
 * modelo solo pide y quien aprueba sigue siendo `validarAcuerdo()`.
 *
 * El socket se inyecta, igual que `ProveedorTwilioSms` inyecta su cliente: es
 * lo que permite probar la conversación entera con un doble.
 */
import type { AgenteDeVoz, OpcionesAgente } from './agente'
import {
  leerEventoDeepgram,
  tramaAjustes,
  tramaRespuestaFuncion,
  URL_DEEPGRAM,
} from './protocolo-deepgram'

export interface ConfigDeepgram {
  apiKey: string
  url?: string
  idioma?: string
  modeloEscucha?: string
  /** Voz de Aura-2. Las de español terminan en `-es`. */
  voz?: string
  proveedorPensar?: 'open_ai' | 'anthropic'
  modeloPensar?: string
}

/** Lo mínimo que se usa de un WebSocket. Un doble lo implementa en diez líneas. */
export interface SocketMinimo {
  send(datos: string | Uint8Array): void
  close(): void
  /**
   * `'arraybuffer'` o el audio del agente llega como `Blob` y se pierde.
   *
   * El `WebSocket` nativo de Node entrega los frames binarios como `Blob` por
   * defecto. El síntoma es de los que cuestan: la llamada conecta, la
   * transcripción aparece, las herramientas corren — y del otro lado no se oye
   * nada, porque cada frame se convertía en cero bytes.
   */
  binaryType?: string
  addEventListener(tipo: 'open', fn: () => void): void
  addEventListener(tipo: 'message', fn: (e: { data: unknown }) => void): void
  addEventListener(tipo: 'close', fn: (e: { reason?: string }) => void): void
  addEventListener(tipo: 'error', fn: (e: unknown) => void): void
}

export type AbrirSocket = (url: string, subprotocolos: string[]) => SocketMinimo

/**
 * Node 22 trae `WebSocket` cliente nativo, así que Deepgram no necesita SDK.
 *
 * La llave viaja como subprotocolo y no como cabecera: el `WebSocket` del
 * navegador —y el nativo de Node, que sigue la misma API— no deja poner
 * cabeceras, y es la forma que Deepgram documenta para ese caso.
 */
const abrirNativo: AbrirSocket = (url, subprotocolos) =>
  new WebSocket(url, subprotocolos) as unknown as SocketMinimo

export class AgenteDeepgram implements AgenteDeVoz {
  readonly nombre: string

  private socket: SocketMinimo | null = null
  private opciones: OpcionesAgente | null = null
  private listo = false
  private msInicio = 0
  /** Audio que llegó antes de que el socket estuviera abierto. */
  private enCola: Uint8Array[] = []

  constructor(
    private readonly config: ConfigDeepgram,
    private readonly abrir: AbrirSocket = abrirNativo,
  ) {
    this.nombre = `deepgram/${config.voz ?? 'aura-2-celeste-es'}`
  }

  async iniciar(opciones: OpcionesAgente): Promise<void> {
    this.opciones = opciones
    this.msInicio = Date.now()

    const socket = this.abrir(this.config.url ?? URL_DEEPGRAM, ['token', this.config.apiKey])
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.addEventListener('open', () => {
      socket.send(
        tramaAjustes({
          idioma: this.config.idioma ?? 'es',
          modeloEscucha: this.config.modeloEscucha ?? 'nova-3',
          proveedorPensar: this.config.proveedorPensar ?? 'open_ai',
          modeloPensar: this.config.modeloPensar ?? 'gpt-4o-mini',
          voz: this.config.voz ?? 'aura-2-celeste-es',
          prompt: opciones.prompt,
          saludo: opciones.saludo,
          funciones: opciones.funciones,
        }),
      )
      this.listo = true
      // Lo que llegó mientras el socket abría. Descartarlo se oiría como que la
      // llamada arranca sorda: Twilio empieza a mandar audio antes.
      for (const trozo of this.enCola) socket.send(trozo)
      this.enCola = []
    })

    socket.addEventListener('message', (e) => this.recibir(e.data))
    socket.addEventListener('close', (e) => opciones.alCerrar(e?.reason || 'socket_cerrado'))
    socket.addEventListener('error', (e) => opciones.alError(e))
  }

  private recibir(datos: unknown): void {
    const o = this.opciones
    if (!o) return

    // Binario = audio del agente. Texto = un evento.
    if (typeof datos !== 'string') {
      o.alAudio(aBytes(datos))
      return
    }

    const evento = leerEventoDeepgram(datos)
    switch (evento.evento) {
      case 'empezo_a_hablar':
        o.alInterrumpir()
        return
      case 'transcripcion':
        o.alTurno({
          quien: evento.quien,
          texto: evento.texto,
          msDesdeInicio: Date.now() - this.msInicio,
        })
        return
      case 'pide_funcion':
        o.alPedirFuncion(evento.pedidos)
        return
      case 'error':
        o.alError(new Error(evento.detalle))
        return
      case 'agente_termino':
        o.alTerminarDeHablar?.()
        return
      case 'ignorable':
        return
      case 'desconocido':
        // Se registra, no se ignora: es lo que deja descubrir en treinta
        // segundos que un campo cambió de nombre, en vez de mirar un socket
        // mudo con un cliente escuchando del otro lado.
        console.warn('[voz] evento de Deepgram sin manejar:', evento.tipo, JSON.stringify(evento.crudo))
        return
      default:
        return
    }
  }

  enviarAudio(mulaw: Uint8Array): void {
    if (!this.socket) return
    if (!this.listo) {
      this.enCola.push(mulaw)
      return
    }
    this.socket.send(mulaw)
  }

  responderFuncion(r: { id: string; name: string; contenido: string }): void {
    this.socket?.send(tramaRespuestaFuncion(r))
  }

  async cerrar(): Promise<void> {
    this.socket?.close()
    this.socket = null
    this.listo = false
  }
}

function aBytes(datos: unknown): Uint8Array {
  if (datos instanceof Uint8Array) return datos
  if (datos instanceof ArrayBuffer) return new Uint8Array(datos)
  if (ArrayBuffer.isView(datos)) {
    return new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength)
  }
  // Con `binaryType = 'arraybuffer'` no debería pasar, pero devolver cero bytes
  // en silencio es exactamente el bug que ese ajuste arregla: mejor que se vea.
  console.warn('[voz] frame binario de tipo inesperado:', Object.prototype.toString.call(datos))
  return new Uint8Array(0)
}

export function configDeepgramDesdeEntorno(
  env: NodeJS.ProcessEnv = process.env,
): ConfigDeepgram | null {
  const apiKey = env.DEEPGRAM_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    idioma: env.VOZ_IDIOMA ?? 'es',
    voz: env.VOZ_VOZ ?? 'aura-2-celeste-es',
    modeloEscucha: env.VOZ_MODELO_ESCUCHA ?? 'nova-3',
    proveedorPensar: (env.VOZ_PROVEEDOR_PENSAR as 'open_ai' | 'anthropic') ?? 'open_ai',
    modeloPensar: env.VOZ_MODELO_PENSAR ?? 'gpt-4o-mini',
  }
}
