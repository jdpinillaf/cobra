import type { Canal } from '@/domain/types'
import { ProveedorMetaCloud, type ConfigMetaCloud } from './meta-cloud'
import { ProveedorSimulado, type ChannelProvider } from './provider'
import { ProveedorTwilioSms, type ConfigTwilioSms } from './twilio'

/**
 * Único punto donde se decide qué implementación atiende cada canal.
 *
 * Existe porque la arquitectura dejó de ser un proveedor para todo: WhatsApp va
 * por Meta Cloud API directo y SMS por Twilio, porque Meta no vende SMS. Sin un
 * router explícito esa asimetría se filtraría a cada sitio que envía.
 *
 * En dev y en test todo cae a `ProveedorSimulado`, que es el default: hay que
 * pedir explícitamente hablar con la red.
 */

export type Proveedores = Record<Canal, ChannelProvider>

/**
 * Lo que cambia de un cliente a otro dentro del canal de WhatsApp.
 *
 * Vive acá y no en `src/repo` para que la dependencia vaya en la dirección que
 * ya va el resto: el repositorio conoce al canal, el canal no conoce a la base.
 *
 * **`appSecret` y `tokenVerificacion` no están en esta lista**, y eso no es un
 * olvido: los dos son de la **App** de Meta, que es una sola y es nuestra. El
 * número, el WABA y el token sí son del cliente. Meterlos todos en la misma
 * bolsa llevaría a pedirle a cada cliente un App Secret que no tiene.
 */
export interface CredencialesWhatsApp {
  /** Id del número dentro del WABA. No es el teléfono, y **es** el remitente. */
  phoneNumberId: string
  wabaId: string
  /** Token de System User, ya descifrado. */
  accessToken: string
}

export interface EntornoCanales {
  PROVEEDOR_WHATSAPP?: string
  PROVEEDOR_SMS?: string

  META_PHONE_NUMBER_ID?: string
  META_WABA_ID?: string
  META_ACCESS_TOKEN?: string
  META_APP_SECRET?: string
  META_TOKEN_VERIFICACION?: string
  META_VERSION_API?: string

  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_SHORT_CODE?: string
}

function exigir(env: EntornoCanales, claves: Array<keyof EntornoCanales>): void {
  const faltan = claves.filter((k) => !env[k])
  if (faltan.length) {
    throw new Error(`Faltan variables de entorno para el canal: ${faltan.join(', ')}`)
  }
}

/**
 * La configuración de Meta, con el número del cliente si lo hay.
 *
 * Las credenciales del tenant ganan sobre las del entorno. Las del entorno
 * quedan como conveniencia de desarrollo —un solo número para probar— y como
 * lo que se usa mientras un cliente todavía no cargó el suyo.
 */
export function configMeta(
  env: EntornoCanales,
  tenant: CredencialesWhatsApp | null = null,
): ConfigMetaCloud {
  // Estas dos son de la App de Meta y no del cliente: hacen falta siempre.
  exigir(env, ['META_APP_SECRET', 'META_TOKEN_VERIFICACION'])

  if (!tenant) {
    exigir(env, ['META_PHONE_NUMBER_ID', 'META_WABA_ID', 'META_ACCESS_TOKEN'])
  }

  return {
    phoneNumberId: tenant?.phoneNumberId ?? env.META_PHONE_NUMBER_ID!,
    wabaId: tenant?.wabaId ?? env.META_WABA_ID!,
    accessToken: tenant?.accessToken ?? env.META_ACCESS_TOKEN!,
    appSecret: env.META_APP_SECRET!,
    tokenVerificacion: env.META_TOKEN_VERIFICACION!,
    versionApi: env.META_VERSION_API,
  }
}

export function configTwilioDesdeEntorno(env: EntornoCanales): ConfigTwilioSms {
  exigir(env, ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SHORT_CODE'])
  return {
    accountSid: env.TWILIO_ACCOUNT_SID!,
    authToken: env.TWILIO_AUTH_TOKEN!,
    remitenteSms: env.TWILIO_SHORT_CODE!,
  }
}

/**
 * Construye el par de proveedores.
 *
 * Falla temprano y ruidosamente si se pide un proveedor real sin credenciales:
 * descubrir que falta el token en mitad de una cadencia significa un deudor sin
 * contactar y un cupo consumido a cambio de nada.
 *
 * **El entorno decide si se habla con la red; el tenant decide desde qué
 * número.** Son dos preguntas distintas y conviene que sigan separadas. Sin
 * `PROVEEDOR_WHATSAPP=meta` no sale nada, aunque el cliente tenga sus
 * credenciales cargadas: es el interruptor que mantiene apagado el motor
 * mientras el código lo revisó una sola persona, y cargarle el número a un
 * cliente no puede encenderlo sin querer.
 */
export function crearProveedores(
  opciones: {
    /** Credenciales del cliente. Sin ellas se usa el número del entorno. */
    tenant?: CredencialesWhatsApp | null
    env?: EntornoCanales
  } = {},
): Proveedores {
  const env = opciones.env ?? (process.env as EntornoCanales)

  const whatsapp =
    env.PROVEEDOR_WHATSAPP === 'meta'
      ? new ProveedorMetaCloud(configMeta(env, opciones.tenant ?? null))
      : new ProveedorSimulado()

  // El SMS no se parte por tenant: el short code es de Ponox y en Colombia no
  // hay forma de que cada cliente tenga el suyo.
  const sms =
    env.PROVEEDOR_SMS === 'twilio'
      ? new ProveedorTwilioSms(configTwilioDesdeEntorno(env))
      : new ProveedorSimulado()

  return { whatsapp, sms }
}
