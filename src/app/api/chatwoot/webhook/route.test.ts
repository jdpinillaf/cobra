import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarDemo, telefonoProtagonista } from '@/demo/estado'
import { recibirMensaje, vistaPorTelefono } from '@/demo/servicio'
import { POST } from './route'

/**
 * El webhook de Chatwoot es la mitad del relevo humano, y tiene una trampa: la
 * propia consola dispara `message_created` por los mensajes que nosotros mismos
 * publicamos al espejar. Sin el filtro de eco, cada respuesta del agente saldría
 * dos veces en el teléfono del deudor.
 */

vi.stubEnv('CEREBRO', 'guionado')

const TELEFONO = telefonoProtagonista()

function evento(over: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/chatwoot/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      content: 'Don Jorge, soy Marcela. Le ayudo con eso.',
      sender: { name: 'Marcela Ríos', type: 'user' },
      conversation: { meta: { sender: { phone_number: TELEFONO, identifier: TELEFONO } } },
      ...over,
    }),
  })
}

beforeEach(async () => {
  reiniciarDemo()
  // Hace falta una conversación abierta para que el relevo tenga dónde caer.
  await recibirMensaje({
    telefono: TELEFONO,
    texto: 'No tengo cómo pagar todo de una',
    urlBase: 'http://localhost:3000',
  })
})

describe('webhook de Chatwoot', () => {
  it('mete en el teléfono lo que escribe un asesor', async () => {
    const respuesta = await POST(evento())

    expect(await respuesta.json()).toEqual({ ok: true, aplicado: true })
    const vista = vistaPorTelefono()
    expect(vista?.mensajes.at(-1)).toMatchObject({ de: 'humano', autor: 'Marcela Ríos' })
    expect(vista?.estadoCaso).toBe('humano')
  })

  it('descarta el eco de lo que nosotros mismos espejamos', async () => {
    const ultimoDelAgente = vistaPorTelefono()!.mensajes.at(-1)!.texto
    const antes = vistaPorTelefono()!.mensajes.length

    const respuesta = await POST(evento({ content: ultimoDelAgente }))

    expect(await respuesta.json()).toMatchObject({ aplicado: false })
    expect(vistaPorTelefono()?.mensajes).toHaveLength(antes)
  })

  it('ignora los entrantes: esos ya vienen por el otro lado', async () => {
    const respuesta = await POST(evento({ message_type: 'incoming' }))
    expect(await respuesta.json()).toMatchObject({ aplicado: false })
  })

  it('ignora las notas internas del equipo', async () => {
    const respuesta = await POST(evento({ private: true }))
    expect(await respuesta.json()).toMatchObject({ aplicado: false })
  })

  it('ignora eventos que no son de mensaje', async () => {
    const respuesta = await POST(evento({ event: 'conversation_status_changed' }))
    expect(await respuesta.json()).toMatchObject({ aplicado: false })
  })

  it('cae al identifier cuando Chatwoot no manda el teléfono', async () => {
    const respuesta = await POST(
      evento({ conversation: { meta: { sender: { identifier: TELEFONO } } } }),
    )
    expect(await respuesta.json()).toMatchObject({ aplicado: true })
  })

  /**
   * Devolver un error hace que Chatwoot reintente y termine deshabilitando la
   * integración. Mejor tragarse el evento malo.
   */
  it('responde 200 aunque el cuerpo venga roto', async () => {
    const respuesta = await POST(
      new Request('http://localhost/api/chatwoot/webhook', { method: 'POST', body: 'no soy json' }),
    )
    expect(respuesta.status).toBe(200)
  })

  it('responde 200 para un teléfono que no tiene conversación', async () => {
    const respuesta = await POST(
      evento({ conversation: { meta: { sender: { phone_number: '+573009999999' } } } }),
    )
    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toMatchObject({ aplicado: false })
  })
})
