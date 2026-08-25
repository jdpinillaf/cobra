/**
 * El agente de voz, como interfaz.
 *
 * Es el `ChannelProvider` de la voz: un solo lugar donde cambiar Deepgram por
 * el simulador. El puente no sabe cuál tiene enfrente, que es lo que permite
 * probar una llamada entera —con acuerdo, link de pago y resumen— sin abrir un
 * socket ni gastar un minuto.
 */
import type { FuncionDeclarada, PedidoDeFuncion } from './funciones'

export interface TurnoVoz {
  quien: 'deudor' | 'agente' | 'sistema'
  texto: string
  msDesdeInicio: number
  /**
   * El deudor pisó al agente a mitad de esta frase.
   *
   * Se guarda porque una transcripción que muestra la frase entera miente
   * sobre lo que la persona alcanzó a oír, y eso importa cuando alguien
   * reclama que "el agente nunca me dijo tal cosa".
   */
  interrumpido?: boolean
}

export interface OpcionesAgente {
  prompt: string
  saludo: string
  funciones: FuncionDeclarada[]
  /** Audio del agente, mulaw 8 kHz crudo. */
  alAudio(mulaw: Uint8Array): void
  /** El deudor arrancó a hablar: hay que callar lo que esté sonando. */
  alInterrumpir(): void
  alTurno(turno: TurnoVoz): void
  /**
   * El agente terminó de decir su frase.
   *
   * Es cuando arranca de verdad la espera del buzón: contarla desde que abre el
   * socket deja al deudor con lo que sobre del saludo para reaccionar —un
   * segundo, si el saludo dura siete— y le cuelga a una persona que sí estaba
   * ahí. El silencio que importa es el que viene **después** de hablar.
   */
  alTerminarDeHablar?(): void
  alPedirFuncion(pedidos: PedidoDeFuncion[]): void
  alCerrar(motivo: string): void
  alError(error: unknown): void
}

export interface AgenteDeVoz {
  readonly nombre: string
  iniciar(opciones: OpcionesAgente): Promise<void>
  enviarAudio(mulaw: Uint8Array): void
  responderFuncion(r: { id: string; name: string; contenido: string }): void
  cerrar(): Promise<void>
}
