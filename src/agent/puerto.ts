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
 * Así que se nombra la frontera: cuatro lecturas y ocho operaciones, con dos
 * implementaciones, y el agente no sabe cuál le tocó.
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
   * El deudor pidió que no lo contacten más.
   *
   * Es una obligación de la Ley 2300 y **no se le delega al modelo**: lo
   * detecta el código sobre lo que la persona dijo, igual que en el webhook de
   * WhatsApp. Una revocación que dependa de que el modelo se acuerde de llamar
   * una herramienta es una revocación que algún día no se registra.
   */
  registrarBaja(en: string): Promise<void>
  /**
   * Qué consultó el agente antes de responder.
   *
   * No es decorativo: es lo que le muestra al cliente que hubo una consulta y
   * no una improvisación, que es la diferencia entre esto y un chatbot.
   */
  anotarPaso(paso: Omit<PasoTraza, 'id' | 'ts'>): Promise<void>
  /** Parte variable de la referencia de pago. Tiene que ser distinta cada vez. */
  nonce(): string
  /**
   * Id para un acuerdo o un pago nuevo. En memoria es un contador legible
   * (`acu_3`); contra base tiene que ser un **uuid**, porque `acuerdos.id` y
   * `pagos.id` son `uuid` en el esquema.
   *
   * Por eso son dos y no uno con `nonce()`: el nonce viaja dentro de una URL
   * que el deudor a veces teclea, así que es corto y sin guiones. Fusionarlos
   * obligaría a elegir entre una llave primaria inválida y un link impronunciable.
   */
  nuevoId(prefijo: 'acu' | 'pag'): string
  /**
   * Lo que costó pensar este turno.
   *
   * Va aparte de `anotarPaso` porque no es un paso: no hay herramienta ni
   * decisión, hay un consumo. Y porque la unidad que se mide y se factura es la
   * **conversación**, no el token — un turno con cuatro herramientas y uno con
   * ninguna cuestan distinto y los dos son un turno.
   */
  anotarConsumoIa(consumo: ConsumoIa): Promise<void>
}

export interface ConsumoIa {
  proveedor: string
  tokensEntrada: number | null
  tokensSalida: number | null
  latenciaMs: number
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

  async registrarBaja(en: string): Promise<void> {
    // La fecha del **primer** pedido es la que vale como evidencia.
    if (this.deudor.consentimiento.revocadoEn === null) {
      this.deudor.consentimiento = { ...this.deudor.consentimiento, revocadoEn: en }
    }
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

  async anotarConsumoIa(): Promise<void> {
    // La demo de la landing no lleva contabilidad: su conversación se pierde al
    // reiniciar y su cartera es de mentira. Medir sobre eso daría un número que
    // no significa nada y que alguien terminaría citando.
  }
}
