import { tarifaDe, type ChannelProvider, type MensajeSaliente, type ResultadoEnvioCanal } from './provider'

/**
 * WhatsApp por Meta Cloud API, directo, sin revendedor.
 *
 * Se llega aquí por economía y no por gusto: un BSP cobra su comisión por
 * mensaje **entrante y saliente**, incluidos los de la ventana de servicio de
 * 24 h que Meta regala. En un agente conversacional esa ventana es el grueso
 * del tráfico, así que la comisión se paga sobre todo por lo que no cuesta.
 *
 * No hay SDK: la Cloud API es HTTP+JSON y `fetch` alcanza. Menos superficie que
 * mantener y una dependencia menos en el bundle del servidor.
 *
 * Lo que este proveedor **no** hace es SMS. Meta no lo vende; ese canal sigue
 * en `ProveedorTwilioSms`.
 */

export interface ConfigMetaCloud {
  /** Id del número dentro del WABA del cliente. No es el teléfono. */
  phoneNumberId: string
  wabaId: string
  /**
   * Token de System User permanente del Business Manager **del cliente**.
   *
   * Con implementaciones 1:1 no hace falta ser Tech Provider ni montar Embedded
   * Signup: basta un System User sobre la WABA del propio cliente. Nunca puede
   * salir del servidor.
   */
  accessToken: string
  /** App Secret, para validar la firma de los webhooks. Distinto del token. */
  appSecret: string
  /** Token compartido del handshake GET del webhook. */
  tokenVerificacion: string
  /** Ej. `v23.0`. Se fija a propósito: Meta rompe cosas entre versiones. */
  versionApi?: string
  /** Idioma con el que quedaron aprobadas las plantillas en Meta. */
  idiomaPlantillas?: string
  /** Inyectable para poder probar sin red. */
  fetch?: typeof globalThis.fetch
}

const VERSION_POR_DEFECTO = 'v23.0'
const IDIOMA_POR_DEFECTO = 'es'

/**
 * Meta espera el destinatario en E.164 **sin** el `+`. Lo acepta con `+` en la
 * mayoría de casos, pero no en todos los endpoints, así que se normaliza.
 */
function paraMeta(e164: string): string {
  return e164.replace(/^\+/, '')
}

export class ProveedorMetaCloud implements ChannelProvider {
  readonly nombre = 'meta'
  private readonly fetch: typeof globalThis.fetch

  constructor(private config: ConfigMetaCloud) {
    this.fetch = config.fetch ?? globalThis.fetch
  }

  private get url(): string {
    const version = this.config.versionApi ?? VERSION_POR_DEFECTO
    return `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`
  }

  async enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvioCanal> {
    if (mensaje.canal !== 'whatsapp') {
      return this.fallo('Meta Cloud API solo envía WhatsApp.', 'canal_no_soportado')
    }

    // Fuera de la ventana de servicio de 24 h WhatsApp solo acepta plantillas.
    // Mandar texto libre ahí falla con 131047 y el intento se pierde; se corta
    // antes para que el planificador reciba un motivo accionable.
    if (!mensaje.plantilla && mensaje.categoria !== 'servicio') {
      return this.fallo(
        `Un mensaje "${mensaje.categoria}" exige plantilla aprobada: fuera de la ventana de 24 h WhatsApp rechaza el texto libre.`,
        'plantilla_requerida',
      )
    }

    let respuesta: Response
    try {
      respuesta = await this.fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.construirPayload(mensaje)),
      })
    } catch (e) {
      // Fallo de red. Nunca debe tumbar la cadencia: se registra y el
      // planificador decide si reintenta o cae a SMS.
      return this.fallo(e instanceof Error ? e.message : String(e), 'red')
    }

    const cuerpo = (await respuesta.json().catch(() => null)) as RespuestaMeta | null

    if (!respuesta.ok || !cuerpo?.messages?.[0]?.id) {
      const error = cuerpo?.error
      return this.fallo(
        error?.message ?? `Meta respondió ${respuesta.status} sin id de mensaje.`,
        error?.code != null ? String(error.code) : String(respuesta.status),
      )
    }

    return {
      ok: true,
      idProveedor: cuerpo.messages[0].id,
      // `encolado`, no `enviado`: Meta acepta de forma asíncrona. El estado
      // real (enviado/entregado/leído/fallido) llega después por webhook y se
      // escribe sobre este contacto usando el `wamid`.
      estado: 'encolado',
      costoCop: tarifaDe(mensaje.canal).costoCop(mensaje.canal, mensaje.categoria),
      error: null,
      codigoError: null,
    }
  }

  private fallo(error: string, codigoError: string): ResultadoEnvioCanal {
    return { ok: false, idProveedor: null, estado: 'fallido', costoCop: 0, error, codigoError }
  }

  private construirPayload(mensaje: MensajeSaliente): Record<string, unknown> {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: paraMeta(mensaje.para),
    }

    if (!mensaje.plantilla) {
      // Solo válido dentro de la ventana de servicio de 24 h. Gratis.
      return { ...base, type: 'text', text: { body: mensaje.cuerpo, preview_url: false } }
    }

    return {
      ...base,
      type: 'template',
      template: {
        // El nombre aprobado en Meta, que el dominio ya modela como
        // `Plantilla.nombreMeta`. No hay ningún id intermedio del proveedor.
        name: mensaje.plantilla.nombre,
        language: {
          code: mensaje.plantilla.idioma ?? this.config.idiomaPlantillas ?? IDIOMA_POR_DEFECTO,
        },
        components: mensaje.plantilla.variables.length
          ? [
              {
                type: 'body',
                parameters: mensaje.plantilla.variables.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      },
    }
  }
}

interface RespuestaMeta {
  messages?: Array<{ id: string; message_status?: string }>
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
}
