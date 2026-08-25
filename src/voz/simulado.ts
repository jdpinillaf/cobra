/**
 * Una llamada sin Twilio, sin Deepgram y sin audio.
 *
 * Reusa `responderGuionado` —el mismo respaldo que corre en producción cuando
 * el modelo falla— para decidir qué contesta y qué herramienta pide. Escribir un
 * segundo guion solo para simular sería una copia del candado: un acuerdo a 12
 * cuotas tiene que rebotar acá igual que en una llamada real, y rebota porque
 * la validación es la misma.
 *
 * Lo único de mentira es que nadie pronunció las frases.
 */
import type { Deudor, LimitesNegociacion, Obligacion } from '@/domain/types'
import { MARCADOR_LINK, responderGuionado } from '@/agent/guionado'
import type { AgenteDeVoz, OpcionesAgente, TurnoVoz } from './agente'

export interface GuionDeVoz {
  /**
   * Lo que dice el deudor, con cuánto espera antes de decirlo.
   *
   * Los tiempos son los de una llamada real —el agente tarda en decir su
   * frase y la persona en contestar—, no los de la simulación: con un reloj
   * virtual el guion corre en milisegundos pero la llamada queda registrada
   * con una duración creíble. Con esperas de un segundo, la pantalla mostraba
   * llamadas de dos segundos y el costo salía mal.
   */
  parlamentos: ReadonlyArray<{ esperaMs: number; texto: string }>
}

/**
 * Reloj virtual: adelanta el tiempo sin gastarlo.
 *
 * El puente calcula la duración con `ahora()`, y el agente espera con
 * `esperar()`. Compartiendo este objeto los dos, el guion termina en
 * milisegundos de reloj de pared y la llamada queda con la duración que
 * habría tenido.
 */
export function relojVirtual(base = Date.now()): {
  ahora(): number
  esperar(ms: number): Promise<void>
} {
  let avance = 0
  return {
    ahora: () => base + avance,
    esperar: (ms) => {
      avance += ms
      return Promise.resolve()
    },
  }
}

export interface ContextoSimulado {
  deudor: Deudor
  obligacion: Obligacion
  limites: LimitesNegociacion
}

/** Los guiones que sabe actuar el simulador. */
export const GUIONES: Record<string, GuionDeVoz> = {
  /**
   * Dos parlamentos, no cuatro. «Listo, hagámosle así» ya dispara el link:
   * agregarle un «mándeme el link» detrás genera **dos** cobros para el mismo
   * acuerdo. Es el mismo motivo por el que el prompt manda confirmar y entregar
   * el link en un solo turno.
   */
  cuotas: {
    parlamentos: [
      { esperaMs: 7_000, texto: 'No tengo cómo pagar todo de una' },
      { esperaMs: 14_000, texto: 'Listo, hagámosle así' },
    ],
  },
  escala: {
    parlamentos: [
      { esperaMs: 7_000, texto: 'No tengo cómo pagar todo de una' },
      { esperaMs: 15_000, texto: '¿Y si me lo dejan en 12 cuotas?' },
    ],
  },
  errado: {
    parlamentos: [
      { esperaMs: 6_000, texto: 'Yo no soy esa persona, se equivocaron' },
    ],
  },
  buzon: { parlamentos: [] },
}

interface Reloj {
  esperar(ms: number): Promise<void>
}

const relojReal: Reloj = { esperar: (ms) => new Promise((r) => setTimeout(r, ms)) }

/**
 * Cuánto tarda el agente en decir una frase.
 *
 * Un TTS en español ronda las 150 palabras por minuto, o unos 14 caracteres por
 * segundo. Sin contarlo, la llamada quedaba registrada solo con las pausas del
 * deudor: veinte segundos para una conversación que en el teléfono habría
 * durado minuto y medio. Y como el costo se calcula sobre la duración, el
 * número que se le muestra al cliente salía a menos de la mitad.
 */
const CARACTERES_POR_SEGUNDO = 14

export const duracionHabladaMs = (texto: string): number =>
  Math.round((texto.length / CARACTERES_POR_SEGUNDO) * 1000)

export class AgenteVozSimulado implements AgenteDeVoz {
  readonly nombre = 'simulado'

  private opciones: OpcionesAgente | null = null
  private cerrado = false
  private ms = 0
  private secuencia = 0
  /** Respuestas de herramientas pendientes, por id de pedido. */
  private readonly esperando = new Map<string, (contenido: string) => void>()

  constructor(
    private readonly guion: GuionDeVoz,
    private readonly ctx: ContextoSimulado,
    private readonly reloj: Reloj = relojReal,
  ) {}

  async iniciar(opciones: OpcionesAgente): Promise<void> {
    this.opciones = opciones
    // El bucle corre solo, como corre una conversación real: `iniciar` no
    // espera a que la llamada termine, igual que no lo hace el socket.
    void this.actuar()
  }

  enviarAudio(): void {
    // No hay audio que procesar: el deudor de la simulación no habla, escribe.
  }

  responderFuncion(r: { id: string; contenido: string }): void {
    this.esperando.get(r.id)?.(r.contenido)
    this.esperando.delete(r.id)
  }

  async cerrar(): Promise<void> {
    this.cerrado = true
  }

  private async turno(quien: TurnoVoz['quien'], texto: string): Promise<void> {
    this.opciones?.alTurno({ quien, texto, msDesdeInicio: this.ms })
    if (quien === 'agente') {
      // El tiempo que el agente pasa hablando cuenta: es minuto facturado.
      const hablando = duracionHabladaMs(texto)
      this.ms += hablando
      await this.reloj.esperar(hablando)
      this.opciones?.alTerminarDeHablar?.()
    }
  }

  /** Pide una herramienta y espera su resultado, igual que haría Deepgram. */
  private pedir(name: string, args: unknown): Promise<string> {
    const id = `sim_${++this.secuencia}`
    return new Promise<string>((resolver) => {
      this.esperando.set(id, resolver)
      this.opciones?.alPedirFuncion([{ id, name, arguments: JSON.stringify(args) }])
    })
  }

  private async actuar(): Promise<void> {
    const o = this.opciones
    if (!o) return

    await this.turno('agente', o.saludo)

    let cuotaPactada: number | null = null

    for (const parlamento of this.guion.parlamentos) {
      if (this.cerrado) return
      await this.reloj.esperar(parlamento.esperaMs)
      if (this.cerrado) return

      this.ms += parlamento.esperaMs
      await this.turno('deudor', parlamento.texto)

      const { texto, accion } = responderGuionado(parlamento.texto, {
        deudor: this.ctx.deudor,
        obligacion: this.ctx.obligacion,
        limites: this.ctx.limites,
        cuotaPactada,
      })

      // Antes de hablar, el agente ejecuta. Igual que en producción: un turno
      // que solo escribe texto cuando había una herramienta que llamar es un
      // turno perdido.
      let dicho = texto
      switch (accion.tipo) {
        case 'acuerdo': {
          await this.pedir('proponerAcuerdo', {
            tipo: 'cuotas',
            montoAcordado: accion.montoTotal,
            numeroCuotas: accion.numeroCuotas,
            descuentoPct: 0,
            primeraCuotaEl: hoyBogota(),
          })
          cuotaPactada = Math.round(accion.montoTotal / accion.numeroCuotas)
          break
        }
        case 'link': {
          const respuesta = await this.pedir('generarLinkDePago', {
            montoCop: accion.montoCop,
            concepto: 'primera cuota del acuerdo',
          })
          /**
           * Por voz la frase se **reescribe**, no se parchea.
           *
           * El texto de WhatsApp termina en «acá le dejo el link para pagar X:
           * {{link}}». Reemplazar el marcador por una frase deja «le dejo el
           * link para pagar X: se lo acabo de mandar», que ningún humano diría.
           * Nadie puede anotar una URL por teléfono, así que el link ya salió
           * por WhatsApp y lo que se dice es eso.
           */
          const url = leerUrl(respuesta)
          const primerNombre = this.ctx.deudor.nombre.split(' ')[0]
          dicho = url
            ? `Perfecto, ${primerNombre}. Le acabo de mandar por WhatsApp el link para pagar ${pesos(accion.montoCop)}. Apenas pague, le llega la confirmación.`
            : texto.replace(MARCADOR_LINK, 'ya se lo envié')
          break
        }
        case 'escalar': {
          await this.pedir('escalarAHumano', {
            motivo: 'fuera_de_limites',
            resumen: parlamento.texto,
          })
          break
        }
        default:
          break
      }

      await this.turno('agente', dicho)
    }

    /**
     * Un guion sin parlamentos es, por definición, nadie del otro lado. Se
     * cierra como `buzon` y no como guion terminado para que la fila quede
     * igual que la de una llamada que contestó un contestador — que es la que
     * hay que mirar cuando el costo por conversación útil se dispara.
     */
    o.alCerrar(this.guion.parlamentos.length === 0 ? 'buzon' : 'guion_terminado')
  }
}

const pesos = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

function leerUrl(contenido: string): string | null {
  try {
    const c = JSON.parse(contenido) as { url?: string }
    return typeof c.url === 'string' ? c.url : null
  } catch {
    return null
  }
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
