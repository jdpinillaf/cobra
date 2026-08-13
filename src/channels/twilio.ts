import twilio from 'twilio'
import type { ResultadoEnvio } from '@/domain/types'
import { tarifaDe, type ChannelProvider, type MensajeSaliente, type ResultadoEnvioCanal } from './provider'

/**
 * SMS por Twilio. **Solo SMS.**
 *
 * WhatsApp se fue a Meta Cloud API directo: un revendedor cobra USD 0.005 por
 * mensaje encima de la tarifa de Meta, entrante y saliente, incluidos los de la
 * ventana de servicio de 24 h que Meta regala.
 *
 * Twilio se queda porque Meta no vende SMS y porque Colombia lo hace caro de
 * montar por cuenta propia: el sender alfanumérico se sobrescribe con un short
 * code local y los números largos virtuales (VLN) están prohibidos, así que
 * `remitenteSms` tiene que ser un short code, no un celular.
 *
 * El SMS nunca sale del cupo del plan: cuesta COP 210 contra COP 45 de overage.
 * Se factura aparte, prepago.
 */

export interface ConfigTwilioSms {
  accountSid: string
  authToken: string
  /** Short code habilitado para Colombia. Un celular no sirve. */
  remitenteSms: string
}

type ClienteTwilio = ReturnType<typeof twilio>

/**
 * Twilio reporta el estado en su propio vocabulario y de forma asíncrona. Se
 * traduce al enum del dominio en vez de asumir `enviado`, que era lo que hacía
 * la implementación anterior y dejaba el log de compliance mintiendo sobre lo
 * que realmente llegó.
 */
const ESTADOS_TWILIO: Record<string, ResultadoEnvio> = {
  queued: 'encolado',
  accepted: 'encolado',
  scheduled: 'encolado',
  sending: 'enviado',
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  undelivered: 'fallido',
  failed: 'fallido',
}

export class ProveedorTwilioSms implements ChannelProvider {
  readonly nombre = 'twilio-sms'
  private cliente: ClienteTwilio

  constructor(
    private config: ConfigTwilioSms,
    cliente?: ClienteTwilio,
  ) {
    this.cliente = cliente ?? twilio(config.accountSid, config.authToken)
  }

  async enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvioCanal> {
    if (mensaje.canal !== 'sms') {
      return {
        ok: false,
        idProveedor: null,
        estado: 'fallido',
        costoCop: 0,
        error: 'Este proveedor quedó reducido a SMS; WhatsApp va por Meta directo.',
        codigoError: 'canal_no_soportado',
      }
    }

    try {
      const creado = await this.cliente.messages.create({
        from: this.config.remitenteSms,
        to: mensaje.para,
        body: mensaje.cuerpo,
      })

      return {
        ok: true,
        idProveedor: creado.sid,
        estado: ESTADOS_TWILIO[creado.status] ?? 'encolado',
        costoCop: tarifaDe(mensaje.canal).costoCop(mensaje.canal, mensaje.categoria),
        error: null,
        codigoError: null,
      }
    } catch (e) {
      // Un fallo de envío nunca debe tumbar la cadencia: se registra y el
      // planificador decide si reintenta. Se preserva el código de Twilio: hay
      // códigos que cambian la decisión, no solo el log.
      const codigo = (e as { code?: number | string })?.code
      return {
        ok: false,
        idProveedor: null,
        estado: 'fallido',
        costoCop: 0,
        error: e instanceof Error ? e.message : String(e),
        codigoError: codigo != null ? String(codigo) : null,
      }
    }
  }
}
