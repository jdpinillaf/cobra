/**
 * El protocolo del Voice Agent de Deepgram, como funciones puras.
 *
 * Deepgram hace escuchar, pensar y hablar en un solo socket
 * (`wss://agent.deepgram.com/v1/agent/converse`). Nosotros ponemos el prompt,
 * las funciones y el audio; él pone el turn-taking, la detección de fin de
 * turno y el barge-in, que son el problema difícil de la voz.
 *
 * Lo que **no** le delegamos es decidir: las funciones van sin `endpoint`, así
 * que un acuerdo lo sigue aprobando `validarAcuerdo()`.
 */
import type { FuncionDeclarada } from './funciones'

export const URL_DEEPGRAM = 'wss://agent.deepgram.com/v1/agent/converse'

export interface AjustesDeepgram {
  idioma: string
  modeloEscucha: string
  proveedorPensar: 'open_ai' | 'anthropic'
  modeloPensar: string
  voz: string
  prompt: string
  saludo: string
  funciones: FuncionDeclarada[]
}

/**
 * El primer mensaje del socket, antes de mandar un solo byte de audio.
 *
 * `mulaw` a 8 kHz de los dos lados: es lo que habla Twilio, y coincidir evita
 * transcodificar. Cualquier otra combinación obliga a resamplear en el puente.
 */
export function tramaAjustes(a: AjustesDeepgram): string {
  return JSON.stringify({
    type: 'Settings',
    audio: {
      input: { encoding: 'mulaw', sample_rate: 8000 },
      output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
    },
    agent: {
      language: a.idioma,
      listen: { provider: { type: 'deepgram', model: a.modeloEscucha } },
      think: {
        provider: { type: a.proveedorPensar, model: a.modeloPensar },
        prompt: a.prompt,
        functions: a.funciones,
      },
      speak: { provider: { type: 'deepgram', model: a.voz } },
      greeting: a.saludo,
    },
  })
}

export function tramaRespuestaFuncion(r: { id: string; name: string; contenido: string }): string {
  return JSON.stringify({
    type: 'FunctionCallResponse',
    id: r.id,
    name: r.name,
    content: r.contenido,
  })
}

export type EventoDeepgram =
  /** El socket abrió. Todavía no valida nada. */
  | { evento: 'conectado' }
  | { evento: 'listo' }
  /** El deudor arrancó a hablar. Hay que callar al agente ya. */
  | { evento: 'empezo_a_hablar' }
  | { evento: 'transcripcion'; quien: 'deudor' | 'agente'; texto: string }
  | { evento: 'pide_funcion'; pedidos: Array<{ id: string; name: string; arguments: string }> }
  | { evento: 'agente_termino' }
  /** Ruido conocido: eco del historial, métricas de latencia, avisos de turno. */
  | { evento: 'ignorable'; tipo: string }
  | { evento: 'error'; detalle: string }
  /**
   * Todo lo que no reconocemos, con el tipo y el crudo adentro.
   *
   * No es cortesía: es lo que permite descubrir en treinta segundos que el
   * campo se llama `output` y no `content`, en vez de mirar un socket mudo con
   * un cliente escuchando del otro lado.
   */
  | { evento: 'desconocido'; tipo: string; crudo: unknown }

interface TramaCruda {
  type?: string
  role?: string
  content?: string
  description?: string
  functions?: Array<{ id?: string; name?: string; arguments?: unknown; client_side?: boolean }>
}

export function leerEventoDeepgram(texto: string): EventoDeepgram {
  let t: TramaCruda
  try {
    t = JSON.parse(texto) as TramaCruda
  } catch {
    return { evento: 'desconocido', tipo: 'json_ilegible', crudo: texto }
  }

  switch (t.type) {
    /**
     * `Welcome` llega apenas conecta el socket, **antes** de que Deepgram
     * valide los ajustes: tratarlo como «listo» hace creer que pasaron cuando
     * el `Error` viene un segundo después. Solo `SettingsApplied` confirma.
     */
    case 'Welcome':
      return { evento: 'conectado' }

    case 'SettingsApplied':
      return { evento: 'listo' }

    case 'UserStartedSpeaking':
      return { evento: 'empezo_a_hablar' }

    case 'ConversationText':
      return {
        evento: 'transcripcion',
        quien: t.role === 'assistant' ? 'agente' : 'deudor',
        texto: t.content ?? '',
      }

    case 'FunctionCallRequest':
      return {
        evento: 'pide_funcion',
        pedidos: (t.functions ?? []).map((f) => ({
          id: f.id ?? '',
          name: f.name ?? '',
          // Deepgram manda los argumentos como string JSON, pero se ha visto
          // llegar el objeto ya parseado. Normalizar acá evita repetir el
          // `typeof` en el ejecutor.
          arguments: typeof f.arguments === 'string' ? f.arguments : JSON.stringify(f.arguments ?? {}),
        })),
      }

    case 'AgentAudioDone':
      return { evento: 'agente_termino' }

    /**
     * Conocidos y sin efecto. Se enumeran en vez de caer en `desconocido`
     * porque ese caso escribe el JSON entero al log: dejarlos ahí ahogaría el
     * evento nuevo de verdad, que es justo lo que ese log existe para mostrar.
     *
     * `History` es el eco de lo que ya se anotó por `ConversationText`;
     * duplicarlo pondría cada turno dos veces en la transcripción.
     */
    case 'History':
    // Deepgram nos devuelve el eco de nuestra propia respuesta de función.
    case 'FunctionCallResponse':
    case 'LatencyReport':
    case 'AgentThinking':
    case 'AgentStartedSpeaking':
    case 'UserStoppedSpeaking':
    case 'PromptUpdated':
    case 'SpeakUpdated':
    case 'Warning':
      return { evento: 'ignorable', tipo: t.type }

    case 'Error':
      return { evento: 'error', detalle: t.description ?? t.content ?? 'sin detalle' }

    default:
      return { evento: 'desconocido', tipo: t.type ?? 'sin_tipo', crudo: t }
  }
}
