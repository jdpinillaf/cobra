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

export function configMetaDesdeEntorno(env: EntornoCanales): ConfigMetaCloud {
  exigir(env, [
    'META_PHONE_NUMBER_ID',
    'META_WABA_ID',
    'META_ACCESS_TOKEN',
    'META_APP_SECRET',
    'META_TOKEN_VERIFICACION',
  ])
  return {
    phoneNumberId: env.META_PHONE_NUMBER_ID!,
    wabaId: env.META_WABA_ID!,
    accessToken: env.META_ACCESS_TOKEN!,
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
 */
export function crearProveedores(env: EntornoCanales = process.env as EntornoCanales): Proveedores {
  const whatsapp =
    env.PROVEEDOR_WHATSAPP === 'meta'
      ? new ProveedorMetaCloud(configMetaDesdeEntorno(env))
      : new ProveedorSimulado()

  const sms =
    env.PROVEEDOR_SMS === 'twilio'
      ? new ProveedorTwilioSms(configTwilioDesdeEntorno(env))
      : new ProveedorSimulado()

  return { whatsapp, sms }
}
