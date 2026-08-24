import { describe, expect, it } from 'vitest'
import { interpretarEntrantes, interpretarEstados, numerosDelPayload } from './meta-webhook'

/**
 * De qué cliente es este webhook.
 *
 * Con un solo cliente la pregunta no existía. Con dos, es la primera que hay
 * que responder y hoy no se puede: `interpretarEntrantes` e
 * `interpretarEstados` aplanan `entry → changes → value` y descartan
 * `metadata.phone_number_id`, que es el único dato del payload que identifica
 * al destinatario.
 *
 * Y no alcanza con mirar el primero: **Meta agrupa en una sola entrega los
 * eventos de todos los números de una misma WABA**. Los números 1 y 2 de Ponox
 * viven en la misma WABA, así que un payload puede traer mensajes de dos
 * clientes distintos mezclados. Atribuir el lote entero al primero sería
 * escribir la conversación de un cliente en la base del otro.
 */

const mensaje = (wamid: string, de: string) => ({
  from: de,
  id: wamid,
  timestamp: '1786000000',
  type: 'text',
  text: { body: 'ya pagué' },
})

const estado = (wamid: string) => ({
  id: wamid,
  status: 'delivered',
  timestamp: '1786000100',
  recipient_id: '573009998877',
})

/** Dos números de la misma WABA en una sola entrega. Es lo que Meta hace. */
const PAYLOAD_MEZCLADO = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-unica',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { display_phone_number: '573001112233', phone_number_id: '10627' },
            messages: [mensaje('wamid.DEL_CLIENTE_A', '573009998877')],
            statuses: [estado('wamid.ESTADO_A')],
          },
        },
        {
          field: 'messages',
          value: {
            metadata: { display_phone_number: '573004445566', phone_number_id: '99881' },
            messages: [mensaje('wamid.DEL_CLIENTE_B', '573007776655')],
            statuses: [estado('wamid.ESTADO_B')],
          },
        },
      ],
    },
  ],
}

describe('atribución de tenant en el webhook', () => {
  it('cada mensaje entrante sabe por qué número llegó', () => {
    const entrantes = interpretarEntrantes(PAYLOAD_MEZCLADO)

    expect(entrantes.map((e) => [e.idProveedor, e.phoneNumberId])).toEqual([
      ['wamid.DEL_CLIENTE_A', '10627'],
      ['wamid.DEL_CLIENTE_B', '99881'],
    ])
  })

  it('cada cambio de estado sabe por qué número llegó', () => {
    const estados = interpretarEstados(PAYLOAD_MEZCLADO)

    expect(estados.map((e) => [e.idProveedor, e.phoneNumberId])).toEqual([
      ['wamid.ESTADO_A', '10627'],
      ['wamid.ESTADO_B', '99881'],
    ])
  })

  it('lista los números presentes, para resolver los tenants de una sola consulta', () => {
    expect(numerosDelPayload(PAYLOAD_MEZCLADO)).toEqual(['10627', '99881'])
  })

  it('no repite un número que aparece en varios bloques', () => {
    const repetido = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: '10627' }, messages: [mensaje('w.1', '57300')] } },
            { field: 'messages', value: { metadata: { phone_number_id: '10627' }, statuses: [estado('w.2')] } },
          ],
        },
      ],
    }

    expect(numerosDelPayload(repetido)).toEqual(['10627'])
  })

  it('un payload sin metadata no revienta y no inventa un número', () => {
    const sinMetadata = {
      entry: [{ changes: [{ field: 'messages', value: { messages: [mensaje('w.1', '57300')] } }] }],
    }

    expect(numerosDelPayload(sinMetadata)).toEqual([])
    // El mensaje se sigue interpretando: descartarlo perdería un entrante real.
    // Queda sin número, y el llamador decide qué hacer con un huérfano.
    expect(interpretarEntrantes(sinMetadata)[0].phoneNumberId).toBeNull()
  })
})
