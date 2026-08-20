import type { Acuerdo, Contacto, Deudor, Obligacion, Pago } from '@/domain/types'
import {
  agregarPaso,
  contactosDelDeudor,
  siguienteNonce,
  type Conversacion,
  type EstadoDemo,
  type PasoTraza,
} from '@/demo/estado'

/**
 * Lo que el agente necesita del mundo.
 *
 * Existía un solo agente y vivía en memoria: `crearHerramientas` recibía el
 * `EstadoDemo` entero y sus seis herramientas lo mutaban directo. Eso alcanzaba
 * mientras el agente fuera la demo de la landing, donde la conversación es un
 * objeto del proceso y se pierde al reiniciar.
 *
 * Para que conteste en la consola hace falta que las mismas seis herramientas
 * escriban en Postgres. La opción de copiarlas era peor de lo que parece: son
 * las que aplican los límites de negociación, y dos copias de un candado es una
 * copia que algún día se afloja sola.
 *
 * Así que se nombra la frontera. Diez operaciones, dos implementaciones, y el
 * agente no sabe cuál le tocó.
 *
 * Las lecturas son campos y no métodos a propósito: se cargan una vez antes del
 * turno y no cambian durante él. Un `saldoTotal` que pudiera cambiar entre dos
 * herramientas del mismo turno haría que el agente diga dos cifras distintas en
 * el mismo mensaje.
 */
export interface PuertoAgente {
  readonly deudor: Deudor
  readonly obligacion: Obligacion
  /** Todo el historial del deudor: el guard cuenta frecuencia cruzando obligaciones. */
  readonly contactosPrevios: Contacto[]
  readonly acuerdoVigente: Acuerdo | null

  guardarAcuerdo(acuerdo: Acuerdo): Promise<void>
  guardarPago(pago: Pago): Promise<void>
  /** El caso pasa a una persona. El agente deja de contestar. */
  tomaUnHumano(): Promise<void>
  /** Alguien avisó que el deudor no es él. */
  marcarNumeroErrado(en: string): Promise<void>
  /**
   * Qué consultó el agente antes de responder.
   *
   * No es decorativo: es lo que le muestra al cliente que hubo una consulta y
   * no una improvisación, que es la diferencia entre esto y un chatbot.
   */
  anotarPaso(paso: Omit<PasoTraza, 'id' | 'ts'>): Promise<void>
  /** Parte variable de la referencia de pago. Tiene que ser distinta cada vez. */
  nonce(): string
  /** Id para un acuerdo o un pago nuevo. En memoria es un contador; en base, un uuid. */
  nuevoId(prefijo: 'acu' | 'pag'): string
}

/**
 * El de la demo de la landing.
 *
 * Envuelve el estado en memoria sin cambiarle nada, así que la demo sigue
 * comportándose igual. Es la implementación de referencia: si algo del puerto no
 * se puede expresar acá, el puerto está mal nombrado.
 */
export class PuertoEnMemoria implements PuertoAgente {
  constructor(
    private readonly estado: EstadoDemo,
    private readonly conversacion: Conversacion,
    readonly deudor: Deudor,
    readonly obligacion: Obligacion,
  ) {}

  get contactosPrevios(): Contacto[] {
    return contactosDelDeudor(this.estado, this.deudor.id)
  }

  get acuerdoVigente(): Acuerdo | null {
    return this.conversacion.acuerdo
  }

  async guardarAcuerdo(acuerdo: Acuerdo): Promise<void> {
    this.conversacion.acuerdo = acuerdo
    this.conversacion.estadoCaso = 'acuerdo'
    this.conversacion.version += 1
  }

  async guardarPago(pago: Pago): Promise<void> {
    this.estado.pagos.set(pago.referencia, pago)
    this.conversacion.pago = pago
    this.conversacion.version += 1
  }

  async tomaUnHumano(): Promise<void> {
    this.conversacion.estadoCaso = 'humano'
    this.conversacion.version += 1
  }

  async marcarNumeroErrado(): Promise<void> {
    // En memoria no hay dónde escribirlo sobre el deudor: la demo se reinicia
    // con cada despliegue y la cartera es de mentira. Lo que importa —que el
    // agente deje de contestar— lo hace `tomaUnHumano`.
    await this.tomaUnHumano()
  }

  async anotarPaso(paso: Omit<PasoTraza, 'id' | 'ts'>): Promise<void> {
    agregarPaso(this.estado, this.conversacion, paso)
  }

  nonce(): string {
    return siguienteNonce(this.estado)
  }

  nuevoId(prefijo: 'acu' | 'pag'): string {
    this.estado.secuencia += 1
    return `${prefijo}_${this.estado.secuencia}`
  }
}
