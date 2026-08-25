/**
 * El agente de cobranza, movido por un modelo, contra un deudor también actuado
 * por un modelo.
 *
 * Es la simulación completa: ningún lado sigue un guion, así que cada corrida
 * es una conversación distinta y las herramientas se llaman —o no— según lo que
 * el modelo decida. Es lo que hace que la demo pruebe algo.
 *
 * **Las herramientas no se ejecutan acá.** Se declaran con un `execute` que
 * delega en el puente, igual que Deepgram delega las funciones sin `endpoint`. Así
 * la validación, el registro y el recorte de límites pasan por el mismo camino
 * que en una llamada real, y `llamada_acciones` se llena igual.
 */
import { generateText, isStepCount, tool, type ModelMessage, type Tool } from 'ai'
import { modeloDelCerebro } from '@/agent/modelo'
import { MARCADOR_LINK, responderGuionado } from '@/agent/guionado'
import type { crearHerramientas } from '@/agent/herramientas'
import type { Deudor, LimitesNegociacion, Obligacion } from '@/domain/types'
import type { AgenteDeVoz, OpcionesAgente, TurnoVoz } from './agente'
import type { DeudorIa } from './deudor-ia'

/** Ocho pasos alcanzan para consultar, validar, generar el link y responder. */
const PASOS_MAXIMOS = 8

interface Reloj {
  esperar(ms: number): Promise<void>
  ahora(): number
}

export class AgenteVozLlm implements AgenteDeVoz {
  readonly nombre: string

  private opciones: OpcionesAgente | null = null
  private cerrado = false
  private ms = 0
  private secuencia = 0
  private readonly esperando = new Map<string, (contenido: string) => void>()

  constructor(
    private readonly deudor: DeudorIa,
    private readonly herramientas: ReturnType<typeof crearHerramientas>,
    private readonly reloj: Reloj,
    etiquetaModelo: string,
    /** Para el respaldo cuando el modelo se queda sin pasos y no dice nada. */
    private readonly expediente?: {
      deudor: Deudor
      obligacion: Obligacion
      limites: LimitesNegociacion
    },
  ) {
    this.nombre = `llm/${etiquetaModelo}`
  }

  async iniciar(opciones: OpcionesAgente): Promise<void> {
    this.opciones = opciones
    void this.actuar()
  }

  enviarAudio(): void {}

  responderFuncion(r: { id: string; contenido: string }): void {
    this.esperando.get(r.id)?.(r.contenido)
    this.esperando.delete(r.id)
  }

  async cerrar(): Promise<void> {
    this.cerrado = true
  }

  private turno(quien: TurnoVoz['quien'], texto: string): void {
    this.opciones?.alTurno({ quien, texto, msDesdeInicio: this.ms })
  }

  /**
   * Las mismas herramientas, pero su `execute` solo **pide**.
   *
   * El puente las ejecuta contra el `PuertoAgente` real y devuelve el
   * resultado, que es lo que el modelo ve. Dos caminos de ejecución —uno para
   * la simulación y otro para la llamada— serían dos lugares donde aplicar los
   * límites, y algún día uno se olvidaría.
   */
  private declararDelegadas(): Record<string, Tool> {
    const delegadas: Record<string, Tool> = {}
    for (const [nombre, original] of Object.entries(this.herramientas)) {
      delegadas[nombre] = tool({
        description: original.description,
        inputSchema: original.inputSchema,
        execute: async (args: unknown) => {
          const id = `llm_${++this.secuencia}`
          const contenido = await new Promise<string>((resolver) => {
            this.esperando.set(id, resolver)
            this.opciones?.alPedirFuncion([{ id, name: nombre, arguments: JSON.stringify(args) }])
          })
          try {
            return JSON.parse(contenido) as unknown
          } catch {
            return { salida: contenido }
          }
        },
      }) as Tool
    }
    return delegadas
  }

  private async actuar(): Promise<void> {
    const o = this.opciones
    if (!o) return

    const cerebro = modeloDelCerebro()
    if (!cerebro) {
      o.alError(new Error('no hay llave de modelo: la llamada entre IAs necesita una'))
      o.alCerrar('sin_modelo')
      return
    }

    const historial: Array<{ quien: 'agente' | 'deudor'; texto: string }> = []
    const decir = (quien: 'agente' | 'deudor', texto: string) => {
      historial.push({ quien, texto })
      this.turno(quien, texto)
    }

    decir('agente', o.saludo)
    // Lo que tarda el saludo en decirse. Es minuto facturado.
    await this.avanzar(o.saludo)

    const delegadas = this.declararDelegadas()

    while (!this.cerrado) {
      const dicho = await this.deudor.responder(historial)
      if (dicho === null) break

      // Lo que la persona tarda en pensar y contestar.
      await this.reloj.esperar(4_000)
      this.ms += 4_000
      decir('deudor', dicho)

      const mensajes: ModelMessage[] = historial.map((t) => ({
        role: t.quien === 'deudor' ? 'user' : 'assistant',
        content: t.texto,
      }))

      let respuesta: string
      try {
        const { text } = await generateText({
          model: cerebro.modelo,
          system: o.prompt,
          messages: mensajes,
          tools: delegadas,
          stopWhen: isStepCount(PASOS_MAXIMOS),
        })
        respuesta = text.trim()
      } catch (error) {
        o.alError(error)
        break
      }

      if (respuesta === '') {
        /**
         * El modelo gastó los ocho pasos llamando herramientas y no llegó a
         * hablar. En WhatsApp eso es un mensaje que no sale; **por teléfono es
         * silencio con la persona esperando**, que es el peor final posible.
         *
         * Lo encontró una simulación entre dos modelos: con un deudor que pedía
         * la baja tres veces, el agente encadenaba `consultarPoliticas` y
         * `escalarAHumano` hasta quedarse sin pasos y no decía una palabra.
         *
         * El respaldo es el mismo que usa `cerebro.ts`: `responderGuionado`, que
         * ya está probado y no inventa cifras. Queda anotado como turno de
         * sistema para que se vea al revisar el prompt.
         */
        this.turno('sistema', 'El agente agotó los pasos sin hablar; contestó el respaldo.')
        respuesta = this.respaldo(dicho)
      }

      decir('agente', respuesta)
      await this.avanzar(respuesta)
    }

    o.alCerrar(historial.some((t) => t.quien === 'deudor') ? 'colgo' : 'buzon')
  }

  /**
   * Qué decir cuando el modelo no dijo nada.
   *
   * Sin cifras nuevas y sin prometer nada: el respaldo solo tiene que sacar a
   * la persona del silencio y cerrar el turno.
   */
  private respaldo(ultimoDelDeudor: string): string {
    if (!this.expediente) {
      return 'Disculpe, se me cortó un momento. Un asesor lo va a contactar para continuar.'
    }
    const { texto } = responderGuionado(ultimoDelDeudor, {
      deudor: this.expediente.deudor,
      obligacion: this.expediente.obligacion,
      limites: this.expediente.limites,
      cuotaPactada: null,
    })
    // El respaldo no genera links: si el texto trae el marcador, se corta ahí.
    return texto.includes(MARCADOR_LINK)
      ? 'Un asesor lo va a contactar para continuar con el pago.'
      : texto
  }

  /** Un TTS en español ronda los 14 caracteres por segundo. */
  private async avanzar(texto: string): Promise<void> {
    const ms = Math.round((texto.length / 14) * 1000)
    this.ms += ms
    await this.reloj.esperar(ms)
    this.opciones?.alTerminarDeHablar?.()
  }
}
