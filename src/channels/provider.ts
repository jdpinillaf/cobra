import type { Canal, ResultadoEnvio } from '@/domain/types'
import { TARIFA_META, TARIFA_TWILIO_SMS, type CategoriaFacturable, type Tarifa } from './tarifas'

/**
 * Abstracción de canal.
 *
 * Hoy hay dos implementaciones reales y **no son intercambiables**: WhatsApp va
 * por Meta Cloud API directo y SMS por Twilio, porque Meta no vende SMS. La
 * interfaz existe para que el motor de cadencia no sepa cuál está usando.
 *
 * El `costoCop` lo resuelve la implementación con su propia `Tarifa`: nadie
 * aguas abajo vuelve a derivar el precio de una tabla, porque depende del
 * proveedor, de la categoría del mensaje, y de si cayó dentro de la ventana de
 * servicio de 24 h (donde vale cero).
 */

export interface MensajeSaliente {
  /** E.164. */
  para: string
  canal: Canal
  /**
   * Plantilla aprobada por Meta. Fuera de una ventana de servicio de 24 horas,
   * WhatsApp solo acepta plantillas: un texto libre se rechaza.
   *
   * `nombre` es el nombre tal como quedó aprobado en Meta (`Plantilla.nombreMeta`).
   */
  plantilla?: { nombre: string; idioma?: string; variables: string[] }
  cuerpo: string
  /**
   * Qué se está enviando, a efectos de precio. Sin esto no se puede cobrar
   * bien: una `marketing` cuesta 25 veces una `utility`, y un `servicio`
   * dentro de la ventana de 24 h es gratis.
   */
  categoria: CategoriaFacturable
}

export interface ResultadoEnvioCanal {
  ok: boolean
  /** `wamid` en Meta, `SID` en Twilio. Es lo que correlaciona el webhook de estado. */
  idProveedor: string | null
  estado: ResultadoEnvio
  costoCop: number
  error: string | null
  /**
   * Código de error del proveedor, sin interpretar.
   *
   * Se preserva porque hay códigos que cambian la decisión del planificador y
   * no solo el log: Meta `131047` es "fuera de la ventana de 24 h, usa
   * plantilla" y `131026` es "no entregable", que son cosas distintas.
   */
  codigoError: string | null
}

export interface ChannelProvider {
  readonly nombre: string
  enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvioCanal>
}

/** La tarifa que corresponde a cada canal en la arquitectura actual. */
export function tarifaDe(canal: Canal): Tarifa {
  return canal === 'whatsapp' ? TARIFA_META : TARIFA_TWILIO_SMS
}

/**
 * Proveedor en memoria para la demo y los tests.
 *
 * Registra todo lo enviado y permite forzar fallos, que es como se prueba el
 * fallback a SMS sin gastar un peso ni depender de la red.
 */
export class ProveedorSimulado implements ChannelProvider {
  readonly nombre = 'simulado'
  readonly enviados: MensajeSaliente[] = []
  private fallaSiguiente = new Set<string>()
  private contador = 0

  /** Hace que el próximo envío a ese número falle, para probar el fallback. */
  programarFallo(numero: string): void {
    this.fallaSiguiente.add(numero)
  }

  async enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvioCanal> {
    this.contador += 1

    if (this.fallaSiguiente.has(mensaje.para)) {
      this.fallaSiguiente.delete(mensaje.para)
      return {
        ok: false,
        idProveedor: null,
        estado: 'fallido',
        costoCop: 0,
        error: 'simulado: número no alcanzable',
        codigoError: 'simulado_no_alcanzable',
      }
    }

    this.enviados.push(mensaje)
    return {
      ok: true,
      idProveedor: `sim_${this.contador}`,
      estado: 'enviado',
      costoCop: tarifaDe(mensaje.canal).costoCop(mensaje.canal, mensaje.categoria),
      error: null,
      codigoError: null,
    }
  }
}

/**
 * Elige el canal del intento.
 *
 * WhatsApp siempre primero: con Meta directo una plantilla `utility` cuesta
 * COP 3,2 contra COP 210 del SMS. El SMS solo entra cuando WhatsApp ya falló y
 * el paso lo autoriza, y se contabiliza fuera del cupo del plan porque a COP 45
 * de overage se perdería plata en cada uno.
 *
 * Vive aquí y no en la implementación de un proveedor: es una regla de negocio,
 * no un detalle de transporte.
 */
export function canalDelIntento(
  canalPreferidoDelPaso: Canal,
  intentoPrevioFallo: boolean,
  fallbackSmsHabilitado: boolean,
): Canal | null {
  if (!intentoPrevioFallo) return canalPreferidoDelPaso
  if (canalPreferidoDelPaso === 'whatsapp' && fallbackSmsHabilitado) return 'sms'
  return null
}

/**
 * Interpola `{{1}}`, `{{2}}`… con las variables de la plantilla, que es el
 * formato posicional que usa Meta.
 */
export function interpolar(cuerpo: string, variables: string[]): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (coincidencia, indice) => {
    const valor = variables[Number(indice) - 1]
    return valor === undefined ? coincidencia : valor
  })
}

/** Formatea pesos colombianos como los lee un deudor. */
export function formatearCop(monto: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(monto)
}
