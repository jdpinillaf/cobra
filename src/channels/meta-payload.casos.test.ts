import { describe, expect, it } from 'vitest'
import { interpretarEntrantes, interpretarEstados } from './meta-webhook'

/**
 * Lo que el payload de Meta trae y todavía no estábamos leyendo.
 *
 * Contrastado contra la documentación vigente de la Cloud API, no contra
 * memoria. Dos hallazgos que cambian decisiones:
 *
 * 1. Meta manda `conversation.expiration_timestamp`: **él** sabe cuándo vence
 *    la ventana de 24 h. Calcularla nosotros desde el entrante es una
 *    aproximación que se desincroniza en los bordes, y la ventana decide si un
 *    mensaje sale gratis o exige plantilla.
 *
 * 2. El detalle accionable del error está en `errors[].error_data.details`, no
 *    en `title`. `title` dice "Re-engagement message"; `details` dice qué hacer.
 */

const conEstado = (status: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { display_phone_number: '573001112233', phone_number_id: '10627' },
            statuses: [status],
          },
        },
      ],
    },
  ],
})

const conEntrante = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '10627' },
            contacts: [{ wa_id: '573009998877', profile: { name: 'Ana Ruiz' } }],
            messages: [{ from: '573009998877', timestamp: '1786000000', ...message }],
          },
        },
      ],
    },
  ],
})

describe('estados: la ventana la dice Meta', () => {
  it('lee expiration_timestamp de la conversación', () => {
    const [e] = interpretarEstados(
      conEstado({
        id: 'wamid.1',
        status: 'delivered',
        timestamp: '1786000000',
        conversation: { id: 'conv_123', expiration_timestamp: '1786086400' },
        pricing: { pricing_model: 'PMP', billable: true, category: 'utility' },
      }),
    )

    expect(e.expiraVentanaEn).toBe(new Date(1_786_086_400 * 1000).toISOString())
    expect(e.conversacionMeta).toBe('conv_123')
  })

  it('deja la ventana en null cuando Meta no la manda', () => {
    const [e] = interpretarEstados(
      conEstado({ id: 'wamid.2', status: 'sent', timestamp: '1786000000' }),
    )

    // Inventar una fecha sería peor que no tenerla: la ventana decide si un
    // mensaje sale gratis o exige plantilla.
    expect(e.expiraVentanaEn).toBeNull()
  })

  it('prefiere error_data.details sobre title, que es lo accionable', () => {
    const [e] = interpretarEstados(
      conEstado({
        id: 'wamid.3',
        status: 'failed',
        timestamp: '1786000000',
        errors: [
          {
            code: 131047,
            title: 'Re-engagement message',
            message: 'Message failed to send',
            error_data: {
              details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
            },
          },
        ],
      }),
    )

    expect(e.codigoError).toBe('131047')
    expect(e.error).toMatch(/24 hours/)
  })

  it('cae a title si no vino error_data', () => {
    const [e] = interpretarEstados(
      conEstado({
        id: 'wamid.4',
        status: 'failed',
        timestamp: '1786000000',
        errors: [{ code: 131026, title: 'Message undeliverable' }],
      }),
    )

    expect(e.error).toBe('Message undeliverable')
  })
})

describe('entrantes: lo que no es texto', () => {
  it('captura el id de una imagen y su epígrafe', () => {
    const [m] = interpretarEntrantes(
      conEntrante({
        id: 'wamid.img',
        type: 'image',
        image: { id: 'media-abc', mime_type: 'image/jpeg', sha256: 'aa', caption: 'ahí está el pago' },
      }),
    )

    // Sin el id de media el comprobante se pierde: la URL de Meta vence a los
    // 5 minutos y no se puede volver a pedir.
    expect(m.media).toEqual({ id: 'media-abc', mimeType: 'image/jpeg', sha256: 'aa' })
    // El epígrafe es texto del deudor y va al hilo como tal.
    expect(m.cuerpo).toBe('ahí está el pago')
  })

  it('captura audio, documento y video con su tipo', () => {
    expect(
      interpretarEntrantes(conEntrante({ id: 'w1', type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg', voice: true } }))[0].media?.id,
    ).toBe('a1')
    expect(
      interpretarEntrantes(conEntrante({ id: 'w2', type: 'document', document: { id: 'd1', mime_type: 'application/pdf', filename: 'recibo.pdf' } }))[0].media?.id,
    ).toBe('d1')
    expect(
      interpretarEntrantes(conEntrante({ id: 'w3', type: 'video', video: { id: 'v1', mime_type: 'video/mp4' } }))[0].media?.id,
    ).toBe('v1')
  })

  it('un mensaje de texto no trae media', () => {
    const [m] = interpretarEntrantes(
      conEntrante({ id: 'wamid.txt', type: 'text', text: { body: 'ya pagué' } }),
    )

    expect(m.media).toBeNull()
    expect(m.cuerpo).toBe('ya pagué')
  })

  it('lee la reacción como texto, para que quede en el hilo', () => {
    const [m] = interpretarEntrantes(
      conEntrante({ id: 'wamid.r', type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.1' } }),
    )

    expect(m.cuerpo).toBe('👍')
  })
})
