import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  interpretarEntrantes,
  interpretarEstados,
  responderVerificacion,
  verificarFirmaMeta,
} from './meta-webhook'

const APP_SECRET = 'secreto_de_la_app'

function firmar(cuerpo: string, secreto = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')}`
}

/** Payload con la forma real de Meta: entry → changes → value. */
const PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '573001112233', phone_number_id: '10627' },
            contacts: [{ profile: { name: 'Ana Ruiz' }, wa_id: '573009998877' }],
            messages: [
              {
                from: '573009998877',
                id: 'wamid.ENTRANTE1',
                timestamp: '1786000000',
                type: 'text',
                text: { body: 'Ya cancelé la cuota ayer' },
              },
            ],
            statuses: [
              {
                id: 'wamid.SALIENTE1',
                status: 'delivered',
                timestamp: '1786000100',
                recipient_id: '573009998877',
                pricing: { billable: true, pricing_model: 'PMP', category: 'utility' },
              },
              {
                id: 'wamid.SALIENTE2',
                status: 'failed',
                timestamp: '1786000200',
                recipient_id: '573001110000',
                errors: [{ code: 131047, title: 'Re-engagement message' }],
              },
            ],
          },
        },
      ],
    },
  ],
}

describe('verificarFirmaMeta', () => {
  const cuerpo = JSON.stringify(PAYLOAD)

  it('acepta la firma correcta', () => {
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo), APP_SECRET)).toBe(true)
  })

  it('rechaza una firma calculada con otro secreto', () => {
    // Es el caso que importa: sin esto, quien conozca la URL puede declarar
    // entregado un mensaje que nunca salió o apagar la cadencia de un moroso.
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo, 'otro'), APP_SECRET)).toBe(false)
  })

  it('rechaza si el cuerpo cambió aunque sea un byte', () => {
    const firma = firmar(cuerpo)
    expect(verificarFirmaMeta(`${cuerpo} `, firma, APP_SECRET)).toBe(false)
  })

  it('rechaza cabecera ausente, vacía o sin el prefijo sha256=', () => {
    expect(verificarFirmaMeta(cuerpo, null, APP_SECRET)).toBe(false)
    expect(verificarFirmaMeta(cuerpo, '', APP_SECRET)).toBe(false)
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo).slice(7), APP_SECRET)).toBe(false)
  })

  it('no explota con una firma de largo distinto', () => {
    expect(verificarFirmaMeta(cuerpo, 'sha256=abc', APP_SECRET)).toBe(false)
  })
})

describe('responderVerificacion', () => {
  it('devuelve el challenge cuando el token cuadra', () => {
    const r = responderVerificacion(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1234' },
      'tok',
    )
    expect(r).toBe('1234')
  })

  it('rechaza un token equivocado', () => {
    const r = responderVerificacion(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'malo', 'hub.challenge': '1234' },
      'tok',
    )
    expect(r).toBeNull()
  })

  it('rechaza si el modo no es subscribe', () => {
    const r = responderVerificacion(
      { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1234' },
      'tok',
    )
    expect(r).toBeNull()
  })
})

describe('interpretarEstados', () => {
  it('traduce los estados de Meta al vocabulario del dominio', () => {
    const estados = interpretarEstados(PAYLOAD)
    expect(estados).toHaveLength(2)
    expect(estados[0]).toMatchObject({
      idProveedor: 'wamid.SALIENTE1',
      estado: 'entregado',
      categoria: 'utility',
      facturable: true,
    })
  })

  it('preserva el código de error, que es lo que cambia la decisión', () => {
    // 131047 es "fuera de la ventana de 24 h, usa plantilla": accionable.
    const fallido = interpretarEstados(PAYLOAD).find((e) => e.estado === 'fallido')
    expect(fallido?.codigoError).toBe('131047')
  })

  it('ignora los cambios que no son de mensajes', () => {
    // Meta manda calidad del número y aprobación de plantillas por el mismo
    // webhook. Procesarlos como mensajes produce basura.
    const otro = {
      entry: [{ changes: [{ field: 'message_template_status_update', value: { statuses: [] } }] }],
    }
    expect(interpretarEstados(otro)).toEqual([])
  })

  it('no inventa estados desconocidos', () => {
    const raro = {
      entry: [
        { changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'inventado' }] } }] },
      ],
    }
    expect(interpretarEstados(raro)).toEqual([])
  })

  it('sobrevive a un payload vacío o malformado', () => {
    expect(interpretarEstados(null)).toEqual([])
    expect(interpretarEstados({})).toEqual([])
    expect(interpretarEstados({ entry: 'no es arreglo' })).toEqual([])
  })
})

describe('interpretarEntrantes', () => {
  it('normaliza el teléfono a E.164 con + y toma el nombre del perfil', () => {
    const [entrante] = interpretarEntrantes(PAYLOAD)
    expect(entrante).toMatchObject({
      idProveedor: 'wamid.ENTRANTE1',
      // Meta lo manda sin `+`; el dominio lo guarda con `+`.
      deTelefono: '+573009998877',
      cuerpo: 'Ya cancelé la cuota ayer',
      nombrePerfil: 'Ana Ruiz',
    })
  })

  it('lee la respuesta de un botón de plantilla, no solo el texto', () => {
    // El opt-out puede venir por un botón y no escrito a mano.
    const conBoton = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: '573009998877',
                    id: 'wamid.BOTON',
                    timestamp: '1786000000',
                    type: 'button',
                    button: { text: 'No me contacten' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(interpretarEntrantes(conBoton)[0].cuerpo).toBe('No me contacten')
  })

  it('convierte el epoch en segundos de Meta a ISO', () => {
    const [entrante] = interpretarEntrantes(PAYLOAD)
    expect(entrante.ocurrioEn).toBe(new Date(1_786_000_000 * 1000).toISOString())
  })
})
