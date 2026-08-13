import { describe, expect, it } from 'vitest'
import { ProveedorMetaCloud } from './meta-cloud'
import { ProveedorSimulado, type ChannelProvider, type MensajeSaliente } from './provider'
import { ProveedorTwilioSms } from './twilio'

/**
 * Contrato de `ChannelProvider`.
 *
 * Una sola suite contra todas las implementaciones. Existe porque la
 * abstracción llevaba meses escrita y **nadie la había ejercitado**: el
 * simulador fabricaba los contactos a mano y la implementación real no tenía un
 * solo test. Un contrato compartido es lo que hace que "cambiar de proveedor es
 * cambiar una implementación" sea verdad y no una aspiración del README.
 */

function fetchQueResponde(cuerpo: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch
}

const metaOk = () =>
  new ProveedorMetaCloud({
    phoneNumberId: '10627',
    wabaId: '1029',
    accessToken: 'tok',
    appSecret: 'sec',
    tokenVerificacion: 'ver',
    fetch: fetchQueResponde({ messages: [{ id: 'wamid.OK', message_status: 'accepted' }] }),
  })

const twilioOk = () =>
  new ProveedorTwilioSms({ accountSid: 'AC1', authToken: 't', remitenteSms: '89000' }, {
    messages: { create: async () => ({ sid: 'SM123', status: 'queued' }) },
  } as never)

interface Caso {
  nombre: string
  canal: MensajeSaliente['canal']
  ok: () => ChannelProvider
  falla: () => ChannelProvider
}

const CASOS: Caso[] = [
  {
    nombre: 'ProveedorSimulado',
    canal: 'whatsapp',
    ok: () => new ProveedorSimulado(),
    falla: () => {
      const p = new ProveedorSimulado()
      p.programarFallo('+573001112233')
      return p
    },
  },
  {
    nombre: 'ProveedorMetaCloud',
    canal: 'whatsapp',
    ok: metaOk,
    falla: () =>
      new ProveedorMetaCloud({
        phoneNumberId: '10627',
        wabaId: '1029',
        accessToken: 'tok',
        appSecret: 'sec',
        tokenVerificacion: 'ver',
        fetch: fetchQueResponde(
          { error: { message: 'Re-engagement message', code: 131047 } },
          400,
        ),
      }),
  },
  {
    nombre: 'ProveedorTwilioSms',
    canal: 'sms',
    ok: twilioOk,
    falla: () =>
      new ProveedorTwilioSms({ accountSid: 'AC1', authToken: 't', remitenteSms: '89000' }, {
        messages: {
          create: async () => {
            throw Object.assign(new Error('The number is unreachable'), { code: 21612 })
          },
        },
      } as never),
  },
]

describe.each(CASOS)('contrato de ChannelProvider: $nombre', (caso) => {
  const mensaje = (over: Partial<MensajeSaliente> = {}): MensajeSaliente => ({
    para: '+573001112233',
    canal: caso.canal,
    cuerpo: 'Recordatorio de pago',
    categoria: 'utility',
    plantilla: caso.canal === 'whatsapp' ? { nombre: 'recordatorio', variables: ['Ana'] } : undefined,
    ...over,
  })

  it('en éxito devuelve un id de proveedor con el que correlacionar el webhook', async () => {
    const r = await caso.ok().enviar(mensaje())

    expect(r.ok).toBe(true)
    // Sin `idProveedor` el estado nunca se puede escribir de vuelta y el log de
    // compliance se queda congelado en el momento del envío.
    expect(r.idProveedor).toBeTruthy()
    expect(r.error).toBeNull()
    expect(r.codigoError).toBeNull()
  })

  it('en éxito cobra según canal y categoría, nunca negativo', async () => {
    const r = await caso.ok().enviar(mensaje())
    expect(r.costoCop).toBeGreaterThanOrEqual(0)
  })

  it('en fallo no cobra, no inventa id, y preserva el código del proveedor', async () => {
    const r = await caso.falla().enviar(mensaje())

    expect(r.ok).toBe(false)
    expect(r.estado).toBe('fallido')
    // Un intento que no salió no puede consumir cupo ni plata del cliente.
    expect(r.costoCop).toBe(0)
    expect(r.idProveedor).toBeNull()
    expect(r.error).toBeTruthy()
    expect(r.codigoError).toBeTruthy()
  })

  it('un fallo se devuelve, nunca se lanza: la cadencia no se puede caer', async () => {
    await expect(caso.falla().enviar(mensaje())).resolves.toBeDefined()
  })

  it('rechaza el canal que no le corresponde sin llamar a la red', async () => {
    const otroCanal = caso.canal === 'whatsapp' ? 'sms' : 'whatsapp'
    const proveedor = caso.ok()
    if (proveedor.nombre === 'simulado') return // el simulado atiende los dos

    const r = await proveedor.enviar(mensaje({ canal: otroCanal }))
    expect(r.ok).toBe(false)
    expect(r.codigoError).toBe('canal_no_soportado')
  })
})

describe('ProveedorMetaCloud, particularidades de Meta', () => {
  it('deja el contacto en `encolado`, no en `enviado`', async () => {
    // Meta acepta de forma asíncrona. Dar por enviado lo que solo fue aceptado
    // es lo que hacía la implementación anterior, y hacía mentir al log.
    const r = await metaOk().enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'x',
      categoria: 'utility',
      plantilla: { nombre: 'recordatorio', variables: [] },
    })
    expect(r.estado).toBe('encolado')
  })

  it('corta el texto libre fuera de la ventana antes de gastar la llamada', async () => {
    const r = await metaOk().enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'Hola, ¿cómo va el pago?',
      categoria: 'utility',
    })

    expect(r.ok).toBe(false)
    expect(r.codigoError).toBe('plantilla_requerida')
  })

  it('deja mandar texto libre cuando es servicio, y no lo cobra', async () => {
    const r = await metaOk().enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'Claro, le explico',
      categoria: 'servicio',
    })

    expect(r.ok).toBe(true)
    expect(r.costoCop).toBe(0)
  })

  it('un fallo de red se reporta, no se propaga', async () => {
    const proveedor = new ProveedorMetaCloud({
      phoneNumberId: '10627',
      wabaId: '1029',
      accessToken: 'tok',
      appSecret: 'sec',
      tokenVerificacion: 'ver',
      fetch: (async () => {
        throw new Error('ECONNRESET')
      }) as unknown as typeof globalThis.fetch,
    })

    const r = await proveedor.enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'x',
      categoria: 'utility',
      plantilla: { nombre: 'recordatorio', variables: [] },
    })

    expect(r).toMatchObject({ ok: false, codigoError: 'red', estado: 'fallido' })
  })
})
