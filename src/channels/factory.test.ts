import { describe, expect, it } from 'vitest'
import { configMeta, crearProveedores, type EntornoCanales } from './factory'

/**
 * Dos preguntas distintas que conviene que sigan separadas: **si** se habla con
 * la red lo decide el entorno, y **desde qué número** lo decide el cliente.
 */

const APP: EntornoCanales = {
  META_APP_SECRET: 'secreto-de-la-app',
  META_TOKEN_VERIFICACION: 'token-de-verificacion',
}

const CON_META: EntornoCanales = {
  ...APP,
  PROVEEDOR_WHATSAPP: 'meta',
  META_PHONE_NUMBER_ID: 'numero-del-entorno',
  META_WABA_ID: 'waba-del-entorno',
  META_ACCESS_TOKEN: 'token-del-entorno',
}

const CLIENTE = {
  phoneNumberId: 'numero-del-cliente',
  wabaId: 'waba-del-cliente',
  accessToken: 'token-del-cliente',
}

describe('configMeta', () => {
  it('el número del cliente le gana al del entorno', () => {
    const config = configMeta(CON_META, CLIENTE)

    expect(config.phoneNumberId).toBe('numero-del-cliente')
    expect(config.wabaId).toBe('waba-del-cliente')
    expect(config.accessToken).toBe('token-del-cliente')
  })

  it('el secreto y el token de verificación siguen siendo de la App', () => {
    // Son de la App de Meta, que es una sola y es nuestra. Pedírselos al
    // cliente sería pedirle algo que no tiene.
    const config = configMeta(CON_META, CLIENTE)

    expect(config.appSecret).toBe('secreto-de-la-app')
    expect(config.tokenVerificacion).toBe('token-de-verificacion')
  })

  it('cae al entorno cuando el cliente todavía no cargó su número', () => {
    expect(configMeta(CON_META, null).phoneNumberId).toBe('numero-del-entorno')
  })

  it('exige el número del entorno solo si no hay cliente', () => {
    expect(() => configMeta(APP, null)).toThrow(/META_PHONE_NUMBER_ID/)
    expect(() => configMeta(APP, CLIENTE)).not.toThrow()
  })

  it('exige siempre el secreto de la App', () => {
    // Sin él no se puede validar la firma de los webhooks, y un webhook sin
    // firma verificada deja inyectar un "BAJA" falso.
    expect(() => configMeta({ ...CON_META, META_APP_SECRET: undefined }, CLIENTE)).toThrow(
      /META_APP_SECRET/,
    )
  })
})

describe('crearProveedores', () => {
  it('sin PROVEEDOR_WHATSAPP=meta no habla con la red, aunque el cliente tenga credenciales', () => {
    // El interruptor que mantiene el motor apagado. Cargarle el número a un
    // cliente no puede encenderlo sin querer.
    const { whatsapp } = crearProveedores({ tenant: CLIENTE, env: APP })
    expect(whatsapp.nombre).toBe('simulado')
  })

  it('con el entorno en meta y credenciales del cliente, usa Meta', () => {
    const { whatsapp } = crearProveedores({ tenant: CLIENTE, env: CON_META })
    expect(whatsapp.nombre).toBe('meta')
  })

  it('el SMS no se parte por tenant', () => {
    // El short code es de Ponox: en Colombia no hay forma de que cada cliente
    // tenga el suyo.
    const { sms } = crearProveedores({ tenant: CLIENTE, env: CON_META })
    expect(sms.nombre).toBe('simulado')
  })

  it('falla ruidoso si se pide Twilio sin credenciales', () => {
    // Descubrirlo en mitad de una cadencia significa un deudor sin contactar.
    expect(() =>
      crearProveedores({ env: { ...CON_META, PROVEEDOR_SMS: 'twilio' } }),
    ).toThrow(/TWILIO/)
  })
})
