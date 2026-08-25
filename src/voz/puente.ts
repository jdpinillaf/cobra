/**
 * El puente: audio de Twilio hacia el agente, audio y decisiones de vuelta.
 *
 * **No importa `ws` ni `node:http`.** Todo lo que toca sockets vive en
 * `servidor.ts` y `deepgram.ts`; acá solo hay lógica. Es lo que permite probar
 * una llamada completa —negociación, acuerdo, link de pago, resumen— con
 * dobles y sin red.
 */
import { ejecutarFuncion, type AccionEjecutada, type FuncionDeclarada, type PedidoDeFuncion } from './funciones'
import type { AgenteDeVoz, TurnoVoz } from './agente'
import { resumirSinModelo, type ResumenLlamada } from './resumen'
import { trocear } from './protocolo-twilio'
import { detectarOptOut } from '@/channels/opt-out'
import type { crearHerramientas } from '@/agent/herramientas'
import type { PuertoAgente } from '@/agent/puerto'

/** Lo mínimo que el puente necesita de Twilio. Un doble lo implementa en seis líneas. */
export interface SalidaTwilio {
  enviarMedia(mulaw: Uint8Array): void
  limpiar(): void
  colgar(): void
}

/** Adónde va lo que pasó. Mismo espíritu que `PuertoAgente`. */
export interface DiarioDeLlamada {
  anotarTurno(turno: TurnoVoz & { indice: number }): Promise<void>
  /**
   * El deudor pisó el turno `indice`.
   *
   * Va aparte de `anotarTurno` porque los turnos se escriben **mientras** la
   * llamada ocurre —una que se corta es justo la que hay que revisar— y la
   * interrupción se sabe después. Mutar el objeto en memoria no alcanzaba: el
   * diario ya se había quedado con una copia, y la transcripción guardada
   * mostraba la frase entera, mintiendo sobre lo que la persona alcanzó a oír.
   */
  marcarInterrumpido(indice: number): Promise<void>
  anotarAccion(accion: AccionEjecutada & { turnoIndice: number }): Promise<void>
  cerrar(cierre: {
    motivo: string
    duracionSeg: number
    resumen: ResumenLlamada
  }): Promise<void>
}

export interface Puente {
  recibirAudio(mulaw: Uint8Array): void
  terminar(motivo: string): Promise<void>
  readonly turnos: readonly TurnoVoz[]
  readonly acciones: readonly AccionEjecutada[]
}

export interface OpcionesPuente {
  agente: AgenteDeVoz
  salida: SalidaTwilio
  diario: DiarioDeLlamada
  herramientas: ReturnType<typeof crearHerramientas>
  /**
   * Para lo que **no** se le delega al modelo.
   *
   * Hoy: la baja. La Ley 2300 le da al deudor el derecho a que dejen de
   * contactarlo, y en el camino de WhatsApp eso lo detecta el código sobre el
   * texto entrante, no el agente. Por voz tiene que ser igual: una simulación
   * entre dos modelos mostró al deudor pidiendo la baja tres veces seguidas
   * mientras el agente escalaba a un asesor y **nadie registraba la
   * revocación**. Es el hueco de cumplimiento más caro que puede tener esto.
   */
  puerto?: PuertoAgente
  prompt: string
  saludo: string
  funciones: FuncionDeclarada[]
  /**
   * Sin voz del deudor en este plazo, se cuelga.
   *
   * Es la regla del buzón, y es plata: Twilio **sí cobra** cuando contesta un
   * contestador, porque para la red la llamada quedó completada. Sin esto se
   * paga el minuto entero por hablarle a una máquina. El AMD de Twilio hace lo
   * mismo mejor, pero cuesta USD 0,0075 y le mete ~2 s de latencia al arranque
   * de **toda** llamada, incluidas las que sí contesta una persona.
   */
  esperaDeVozMs?: number
  /** Sin respuesta de una herramienta, se contesta con error y la charla sigue. */
  esperaMaximaFuncionMs?: number
  ahora?: () => number
  programar?: (fn: () => void, ms: number) => { cancelar(): void }
}

const relojReal = () => Date.now()
const programarReal = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms)
  return { cancelar: () => clearTimeout(id) }
}

export async function abrirPuente(o: OpcionesPuente): Promise<Puente> {
  const ahora = o.ahora ?? relojReal
  const programar = o.programar ?? programarReal
  const esperaDeVoz = o.esperaDeVozMs ?? 8_000
  const esperaFuncion = o.esperaMaximaFuncionMs ?? 4_000

  const inicio = ahora()
  const turnos: TurnoVoz[] = []
  const acciones: AccionEjecutada[] = []

  /**
   * Cola propia de audio pendiente.
   *
   * Existe **solo** por el barge-in. `clear` vacía lo que Twilio tiene en cola,
   * pero si nosotros seguimos empujando lo que ya teníamos troceado, el agente
   * vuelve a hablar encima del deudor medio segundo después. Vaciar las dos es
   * lo que hace que la interrupción se oiga natural.
   */
  let pendiente: Uint8Array[] = []
  let huboVoz = false
  /**
   * El cierre en vuelo.
   *
   * No alcanza con un `cerrado = true`. `alCerrar` llega desde un callback del
   * agente, así que el puente lo dispara con `void terminar(...)`: quien llame
   * a `terminar()` después se encontraba con que ya estaba cerrado y volvía
   * enseguida, **sin esperar la escritura**. El proceso terminaba antes que el
   * `UPDATE` y la llamada quedaba para siempre en `en_curso`, sin duración,
   * sin resumen y sin costo. Guardar la promesa hace que el segundo llamador
   * espere la misma faena en vez de saltearla.
   */
  let cierre: Promise<void> | null = null
  const estaCerrado = () => cierre !== null

  const drenar = () => {
    while (pendiente.length > 0) {
      const trozo = pendiente.shift()
      if (trozo) o.salida.enviarMedia(trozo)
    }
  }

  /**
   * El guardia del buzón se **rearma** cada vez que el agente termina de
   * hablar, y no corre mientras habla.
   *
   * Contarlo desde que abre el socket le colgaba a una persona de verdad: el
   * saludo dura unos siete segundos de TTS, así que de los ocho de espera le
   * quedaba uno para reaccionar. El silencio que delata a un contestador es el
   * que viene **después** de que el agente terminó su frase.
   */
  let guardia = { cancelar: () => {} }
  const armarGuardia = () => {
    guardia.cancelar()
    if (huboVoz || estaCerrado()) return
    guardia = programar(() => {
      if (!huboVoz && !estaCerrado()) void terminar('buzon')
    }, esperaDeVoz)
  }
  armarGuardia()

  async function anotar(turno: TurnoVoz): Promise<void> {
    const indice = turnos.length
    turnos.push(turno)
    await o.diario.anotarTurno({ ...turno, indice })
  }

  async function atender(pedidos: PedidoDeFuncion[]): Promise<void> {
    for (const pedido of pedidos) {
      let respondido = false
      const responder = (contenido: string) => {
        if (respondido) return
        respondido = true
        o.agente.responderFuncion({ id: pedido.id, name: pedido.name, contenido })
      }

      // El watchdog: si la herramienta se cuelga, Deepgram queda esperando y la
      // llamada se muere muda. Mejor una respuesta de error que un silencio.
      const reloj = programar(
        () => responder(JSON.stringify({ error: 'sin_respuesta', detalle: 'la herramienta no respondió' })),
        esperaFuncion,
      )

      const accion = await ejecutarFuncion(o.herramientas, pedido, ahora)
      reloj.cancelar()
      responder(accion.contenido)

      acciones.push(accion)
      await o.diario.anotarAccion({ ...accion, turnoIndice: Math.max(0, turnos.length - 1) })
    }
  }

  /**
   * La baja, decidida por el código.
   *
   * Se registra una sola vez y se contesta una sola vez: repetir «no le
   * volvemos a llamar» en cada turno es exactamente lo que la persona pidió
   * que dejara de pasar.
   */
  let bajaRegistrada = false
  async function atenderBaja(texto: string): Promise<void> {
    if (bajaRegistrada || !o.puerto || !detectarOptOut(texto)) return
    bajaRegistrada = true

    await o.puerto.registrarBaja(new Date(ahora()).toISOString())
    await o.puerto.anotarPaso({
      herramienta: 'registrarBaja',
      detalle: `El deudor pidió la baja durante la llamada: «${texto}»`,
      estado: 'bloqueado',
    })

    const despedida = 'Listo. No le volvemos a llamar ni a escribir. Gracias por avisarnos.'
    await anotar({ quien: 'agente', texto: despedida, msDesdeInicio: ahora() - inicio })
    await terminar('baja')
  }

  function terminar(motivo: string): Promise<void> {
    if (cierre) return cierre
    cierre = (async () => {
      guardia.cancelar()
      pendiente = []

      await o.agente.cerrar().catch(() => {})
      o.salida.colgar()

      await o.diario.cerrar({
        motivo,
        duracionSeg: Math.round((ahora() - inicio) / 1000),
        resumen: resumirSinModelo(turnos, acciones, motivo),
      })
    })()
    return cierre
  }

  await o.agente.iniciar({
    prompt: o.prompt,
    saludo: o.saludo,
    funciones: o.funciones,

    alAudio(mulaw) {
      if (estaCerrado()) return
      pendiente.push(...trocear(mulaw))
      drenar()
    },

    alInterrumpir() {
      // Las dos colas, en este orden. Ver el comentario de `pendiente`.
      pendiente = []
      o.salida.limpiar()
      const indice = turnos.length - 1
      const ultimo = turnos[indice]
      if (ultimo?.quien === 'agente') {
        ultimo.interrumpido = true
        void o.diario.marcarInterrumpido(indice)
      }
    },

    alTerminarDeHablar() {
      armarGuardia()
    },

    alTurno(turno) {
      if (turno.quien === 'deudor') {
        huboVoz = true
        guardia.cancelar()
        void atenderBaja(turno.texto)
      }
      void anotar(turno)
    },

    alPedirFuncion(pedidos) {
      void atender(pedidos)
    },

    alCerrar(motivo) {
      void terminar(motivo)
    },

    alError(error) {
      void anotar({
        quien: 'sistema',
        texto: `error del agente: ${error instanceof Error ? error.message : String(error)}`,
        msDesdeInicio: ahora() - inicio,
      })
    },
  })

  return {
    recibirAudio(mulaw) {
      if (!estaCerrado()) o.agente.enviarAudio(mulaw)
    },
    terminar,
    turnos,
    acciones,
  }
}
