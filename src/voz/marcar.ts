/**
 * Quien marca el teléfono.
 *
 * Interfaz aparte del agente de voz porque son dos decisiones distintas: con
 * qué se habla y por dónde sale la llamada. Y porque `TelefonistaSimulada`
 * permite ensayar el camino entero sin gastar un minuto.
 */
import twilio from 'twilio'

export interface Llamada {
  idProveedor: string
  estado: string
}

export interface Telefonista {
  readonly nombre: string
  llamar(params: { a: string; twiml: string; grabar?: boolean }): Promise<Llamada>
}

export interface ConfigTwilioVoz {
  accountSid: string
  authToken: string
  desde: string
}

type ClienteTwilio = ReturnType<typeof twilio>

export class TelefonistaTwilio implements Telefonista {
  readonly nombre = 'twilio'
  private readonly cliente: ClienteTwilio

  constructor(config: ConfigTwilioVoz, cliente?: ClienteTwilio) {
    this.cliente = cliente ?? twilio(config.accountSid, config.authToken)
    this.desde = config.desde
  }

  private readonly desde: string

  async llamar(params: { a: string; twiml: string; grabar?: boolean }): Promise<Llamada> {
    /**
     * El TwiML va **en línea**, no por URL.
     *
     * Twilio acepta las dos formas; con `twiml` no hace falta exponer un
     * endpoint HTTP más ni que Twilio pueda alcanzarlo. Un endpoint menos en el
     * túnel es un modo de falla menos el día de la demo.
     */
    const llamada = await this.cliente.calls.create({
      to: params.a,
      from: this.desde,
      twiml: params.twiml,
      record: params.grabar ?? true,
    })
    return { idProveedor: llamada.sid, estado: llamada.status }
  }
}

/** No llama a nadie. Devuelve un SID con forma de SID para no romper nada aguas abajo. */
export class TelefonistaSimulada implements Telefonista {
  readonly nombre = 'simulado'
  private n = 0

  async llamar(): Promise<Llamada> {
    return { idProveedor: `CAsimulada${++this.n}`, estado: 'queued' }
  }
}

export function configTwilioVozDesdeEntorno(
  env: NodeJS.ProcessEnv = process.env,
): ConfigTwilioVoz | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMERO_VOZ } = env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_NUMERO_VOZ) return null
  return {
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    desde: TWILIO_NUMERO_VOZ,
  }
}
