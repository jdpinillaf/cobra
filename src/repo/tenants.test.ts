import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { credencialesWhatsApp, guardarCredencialesWhatsApp } from './tenants'
import { crearBaseDePrueba, type BaseDePrueba } from './prueba'

/**
 * El remitente sale del cliente, no del despliegue.
 *
 * El caso que estos tests protegen no se ve con un cliente: con dos vivos en la
 * misma WABA, un remitente único le contesta al deudor del segundo desde el
 * número del primero.
 */

const UNO = '11111111-1111-4111-8111-111111111111'
const DOS = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'EAAG-token-de-system-user-del-cliente'

describe('credenciales de WhatsApp por tenant', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    process.env.SECRETO_CREDENCIALES ??= 'secreto de pruebas suficientemente largo'
    base = await crearBaseDePrueba()
  })
  afterAll(async () => base.cerrar())
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(UNO, 'Ferretería El Tornillo')
    await base.sembrarTenant(DOS, 'Panadería Doña Luz')
  })

  it('devuelve null mientras el cliente no cargó su número', async () => {
    // Un tenant en borrador todavía no tiene WABA. No es un error: el llamador
    // cae al número del entorno.
    expect(await credencialesWhatsApp(base.db, UNO)).toBeNull()
  })

  it('guarda y devuelve las credenciales del cliente', async () => {
    await guardarCredencialesWhatsApp(base.db, UNO, {
      phoneNumberId: '111000111',
      wabaId: 'waba-uno',
      accessToken: TOKEN,
      propietario: 'cliente',
    })

    expect(await credencialesWhatsApp(base.db, UNO)).toEqual({
      phoneNumberId: '111000111',
      wabaId: 'waba-uno',
      accessToken: TOKEN,
    })
  })

  it('no deja el token en claro en la base', async () => {
    await guardarCredencialesWhatsApp(base.db, UNO, {
      phoneNumberId: '111000111',
      wabaId: 'waba-uno',
      accessToken: TOKEN,
    })

    const [fila] = await base.db.query<{ wa_token_cifrado: string }>(
      'SELECT wa_token_cifrado FROM tenants WHERE id = $1',
      [UNO],
    )
    expect(fila.wa_token_cifrado).not.toContain('system-user')
    expect(fila.wa_token_cifrado.startsWith('gcm1$')).toBe(true)
  })

  it('cada cliente responde con su propio número', async () => {
    await guardarCredencialesWhatsApp(base.db, UNO, {
      phoneNumberId: '111000111',
      wabaId: 'waba-uno',
      accessToken: 'token-uno',
    })
    await guardarCredencialesWhatsApp(base.db, DOS, {
      phoneNumberId: '222000222',
      wabaId: 'waba-dos',
      accessToken: 'token-dos',
    })

    const uno = await credencialesWhatsApp(base.db, UNO)
    const dos = await credencialesWhatsApp(base.db, DOS)

    expect(uno?.phoneNumberId).toBe('111000111')
    expect(dos?.phoneNumberId).toBe('222000222')
    expect(uno?.accessToken).not.toBe(dos?.accessToken)
  })

  it('rechaza un token que alguien escribió sin cifrar', async () => {
    // Un UPDATE a mano desde el panel de Supabase es el camino por el que un
    // token vuelve a quedar en claro. Usarlo en silencio dejaría el agujero
    // abierto para siempre, porque nada volvería a avisar.
    await base.db.query(
      `UPDATE tenants SET phone_number_id = $2, waba_id = $3, wa_token_cifrado = $4 WHERE id = $1`,
      [UNO, '111000111', 'waba-uno', TOKEN],
    )

    await expect(credencialesWhatsApp(base.db, UNO)).rejects.toThrow(/sin cifrar/i)
  })

  it('devuelve null si falta alguna de las tres piezas', async () => {
    // Un número sin token no sirve para enviar, y armar el proveedor con eso
    // fallaría recién contra la red, con el cupo ya consumido.
    await base.db.query(`UPDATE tenants SET phone_number_id = $2 WHERE id = $1`, [UNO, '111000111'])
    expect(await credencialesWhatsApp(base.db, UNO)).toBeNull()
  })
})
