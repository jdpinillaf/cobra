import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { filtrarPorNumero, numerosDelPayload } from '@/channels/meta-webhook'
import { procesarWebhook } from '@/channels/procesador-webhook'
import { hiloDeConversacion, listarBandeja } from '@/repo/cobranza/conversaciones'
import { ventanaDe } from '@/repo/cobranza/ventanas'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { RepositorioPostgres } from './webhook-pg'

/**
 * El webhook, de punta a punta contra Postgres.
 *
 * `procesarWebhook` no cambió: la orquestación estaba escrita y probada contra
 * un repositorio en memoria, y esto solo implementa la misma interfaz de seis
 * métodos contra la base. Que no haya hecho falta tocarla es el punto de
 * haberla definido antes de tener base.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const DEUDOR_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DEUDOR_B = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'
const OBL_A = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const OBL_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const USUARIO = 'cccccccc-1111-4111-8111-cccccccccccc'

const TEL_A = '+573001112233'
const TEL_B = '+573004445566'

/** Un lote con los dos clientes adentro. Es lo que Meta entrega de verdad. */
const LOTE_MEZCLADO = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-unica',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '10627' },
            contacts: [{ wa_id: '573001112233', profile: { name: 'Ana' } }],
            messages: [
              {
                from: '573001112233',
                id: 'wamid.DE_A',
                timestamp: '1786000000',
                type: 'text',
                text: { body: 'ya pagué' },
              },
            ],
          },
        },
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '99881' },
            contacts: [{ wa_id: '573004445566', profile: { name: 'Luis' } }],
            messages: [
              {
                from: '573004445566',
                id: 'wamid.DE_B',
                timestamp: '1786000100',
                type: 'image',
                image: { id: 'media-xyz', mime_type: 'image/jpeg', caption: 'el comprobante' },
              },
            ],
          },
        },
      ],
    },
  ],
}

describe('webhook contra Postgres', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(A, 'Ferretería El Tornillo')
    await base.sembrarTenant(B, 'Distribuidora Andina')
    await base.sembrarUsuario(A, USUARIO, 'marcela@tornillo.co')
    await base.sembrarDeudorConObligacion(A, DEUDOR_A, OBL_A)
    await base.sembrarDeudorConObligacion(B, DEUDOR_B, OBL_B)
    await base.db.query(`UPDATE deudores SET telefonos = ARRAY[$2::text] WHERE id = $1`, [DEUDOR_A, TEL_A])
    await base.db.query(`UPDATE deudores SET telefonos = ARRAY[$2::text] WHERE id = $1`, [DEUDOR_B, TEL_B])
    await base.db.query(`UPDATE tenants SET phone_number_id = '10627' WHERE id = $1`, [A])
    await base.db.query(`UPDATE tenants SET phone_number_id = '99881' WHERE id = $1`, [B])
  })

  /** Lo que hace la ruta: resolver tenant por número y procesar cada parte aparte. */
  async function procesarLote(payload: unknown) {
    for (const numero of numerosDelPayload(payload)) {
      const [t] = await base.db.query<{ id: string }>(
        `SELECT id FROM tenants WHERE phone_number_id = $1`,
        [numero],
      )
      if (!t) continue
      await procesarWebhook(
        filtrarPorNumero(payload, numero),
        new RepositorioPostgres(base.db, t.id),
      )
    }
  }

  /** Un entrante suelto de un solo número. */
  function unEntrante(telefono: string, id: string, cuerpo: string, ts = '1786000000') {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-unica',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '10627' },
                messages: [
                  {
                    from: telefono.replace('+', ''),
                    id,
                    timestamp: ts,
                    type: 'text',
                    text: { body: cuerpo },
                  },
                ],
              },
            },
          ],
        },
      ],
    }
  }

  it('no mezcla dos clientes que vienen en la misma entrega', async () => {
    await procesarLote(LOTE_MEZCLADO)

    const deA = await listarBandeja(base.db, A, { usuarioId: USUARIO })
    const deB = await listarBandeja(base.db, B, { usuarioId: USUARIO })

    // El caso que Meta produce de verdad al tener dos números en una WABA.
    // Procesar el lote entero bajo un tenant escribiría la conversación de una
    // empresa en la base de la otra.
    expect(deA).toHaveLength(1)
    expect(deA[0].ultimoMensaje).toBe('ya pagué')
    expect(deB).toHaveLength(1)
    expect(deB[0].ultimoMensaje).toBe('el comprobante')
  })

  it('guarda el id de media, que es lo que sostiene los comprobantes', async () => {
    await procesarLote(LOTE_MEZCLADO)

    const [fila] = await base.db.query<{ media_id: string; media_mime: string }>(
      `SELECT media_id, media_mime FROM contactos WHERE tenant_id = $1 AND id_proveedor = 'wamid.DE_B'`,
      [B],
    )

    // La URL de descarga de Meta vence a los cinco minutos y no se vuelve a
    // pedir: sin este id el comprobante se pierde para siempre.
    expect(fila.media_id).toBe('media-xyz')
    expect(fila.media_mime).toBe('image/jpeg')
  })

  it('abre la ventana de 24 h del deudor que escribió', async () => {
    await procesarLote(LOTE_MEZCLADO)

    const ventana = await ventanaDe(base.db, A, DEUDOR_A)

    expect(ventana).not.toBeNull()
    expect(new Date(ventana!.expiraEn).getTime() - new Date(ventana!.abiertaEn).getTime()).toBe(
      24 * 60 * 60 * 1000,
    )
  })

  it('la reentrega de Meta no duplica el mensaje', async () => {
    await procesarLote(LOTE_MEZCLADO)
    await procesarLote(LOTE_MEZCLADO)

    // Meta reintenta hasta recibir un 200, y reintenta de verdad. Con la
    // idempotencia en un Set de proceso, dos instancias en Vercel no se enteran
    // una de la otra y el deudor recibe dos respuestas.
    const [c] = await base.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contactos WHERE tenant_id = $1`,
      [A],
    )
    expect(c.n).toBe(1)
  })

  it('un opt-out revoca el consentimiento y no se pisa la fecha', async () => {
    const baja = (id: string, texto: string, ts: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '10627' },
                messages: [{ from: '573001112233', id, timestamp: ts, type: 'text', text: { body: texto } }],
              },
            },
          ],
        },
      ],
    })

    await procesarLote(baja('wamid.b1', 'no me contacten más', '1786000000'))
    const [primera] = await base.db.query<{ revocado_en: Date }>(
      `SELECT revocado_en FROM deudores WHERE id = $1`,
      [DEUDOR_A],
    )

    await procesarLote(baja('wamid.b2', 'ya les dije, dar de baja', '1786003600'))
    const [segunda] = await base.db.query<{ revocado_en: Date }>(
      `SELECT revocado_en FROM deudores WHERE id = $1`,
      [DEUDOR_A],
    )

    // La fecha del primer pedido es la evidencia ante la SIC. Cada mensaje
    // posterior la reescribía hacia adelante.
    expect(new Date(segunda.revocado_en).getTime()).toBe(new Date(primera.revocado_en).getTime())
  })

  it('un número que no está en la cartera no rompe el lote', async () => {
    const desconocido = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '10627' },
                messages: [
                  { from: '573009999999', id: 'wamid.x', timestamp: '1786000000', type: 'text', text: { body: 'hola?' } },
                ],
              },
            },
          ],
        },
      ],
    }

    // Un desconocido escribiendo al número de la empresa es normal. No puede
    // hacer que Meta reintente el lote entero.
    await expect(procesarLote(desconocido)).resolves.not.toThrow()
    expect(await listarBandeja(base.db, A, { usuarioId: USUARIO })).toHaveLength(0)
  })

  it('el estado de entrega se escribe sobre el contacto que lo originó', async () => {
    const conv = await base.db.query<{ id: string }>(
      `INSERT INTO conversaciones (tenant_id, deudor_id, obligacion_id, abierta_en)
       VALUES ($1,$2,$3, now()) RETURNING id`,
      [A, DEUDOR_A, OBL_A],
    )
    await base.db.query(
      `INSERT INTO contactos (tenant_id, obligacion_id, deudor_id, conversacion_id, canal, direccion,
                              ocurrido_en, cuerpo, resultado, id_proveedor, costo_cop)
       VALUES ($1,$2,$3,$4,'whatsapp','saliente', now(), 'hola', 'encolado', 'wamid.OUT', 3.2)`,
      [A, OBL_A, DEUDOR_A, conv[0].id],
    )

    const estado = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '10627' },
                statuses: [
                  {
                    id: 'wamid.OUT',
                    status: 'delivered',
                    timestamp: '1786000000',
                    conversation: { id: 'conv_1', expiration_timestamp: '1786086400' },
                    pricing: { billable: true, category: 'utility', pricing_model: 'PMP' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    await procesarLote(estado)

    const hilo = await hiloDeConversacion(base.db, A, conv[0].id)
    expect(hilo[0].resultado).toBe('entregado')
  })

  it('el aviso de número errado frena la cadencia y le deja el caso a alguien', async () => {
    // Antes de esto el mensaje se registraba, se abría la ventana de 24 h y la
    // cadencia seguía escribiéndole a un tercero que ya había avisado que no es
    // el deudor. No es una molestia: es tratamiento de datos de quien nunca
    // autorizó nada.
    await procesarLote(unEntrante(TEL_A, 'wamid.NO_SOY', 'yo no soy, ese número está equivocado'))

    const [deudor] = await base.db.query<{ numero_errado_en: Date | null }>(
      `SELECT numero_errado_en FROM deudores WHERE tenant_id = $1 AND id = $2`,
      [A, DEUDOR_A],
    )
    expect(deudor.numero_errado_en).not.toBeNull()

    // Marcar sin pausar dejaría el número mudo para siempre sin que a nadie le
    // aparezca el caso: el guard frenando y ninguna persona verificando si el
    // dato de la cartera estaba mal o si el deudor está esquivando.
    const [conversacion] = await base.db.query<{ agente_pausado: boolean }>(
      `SELECT agente_pausado FROM conversaciones WHERE tenant_id = $1 AND deudor_id = $2`,
      [A, DEUDOR_A],
    )
    expect(conversacion.agente_pausado).toBe(true)
  })

  it('conserva la fecha del primer aviso, que es la que vale', async () => {
    await procesarLote(unEntrante(TEL_A, 'wamid.NO_SOY_1', 'este no es mi número'))
    const [primera] = await base.db.query<{ numero_errado_en: Date }>(
      `SELECT numero_errado_en FROM deudores WHERE tenant_id = $1 AND id = $2`,
      [A, DEUDOR_A],
    )

    await procesarLote(unEntrante(TEL_A, 'wamid.NO_SOY_2', 'ya le dije que no soy yo', '1786100000'))
    const [segunda] = await base.db.query<{ numero_errado_en: Date }>(
      `SELECT numero_errado_en FROM deudores WHERE tenant_id = $1 AND id = $2`,
      [A, DEUDOR_A],
    )

    // Cada aviso posterior la reescribía hacia adelante y borraba el dato: hace
    // cuánto que se sabe que este número no es del deudor.
    expect(segunda.numero_errado_en.getTime()).toBe(primera.numero_errado_en.getTime())
  })

  it('no marca a nadie por un "no soy capaz de pagar"', async () => {
    await procesarLote(unEntrante(TEL_A, 'wamid.CAPAZ', 'no soy capaz de pagar todo este mes'))

    const [deudor] = await base.db.query<{ numero_errado_en: Date | null }>(
      `SELECT numero_errado_en FROM deudores WHERE tenant_id = $1 AND id = $2`,
      [A, DEUDOR_A],
    )
    expect(deudor.numero_errado_en).toBeNull()
  })

  it('el deudor que ya pagó todo también puede escribir', async () => {
    // `obligacionAbierta` devuelve null cuando no queda ninguna sin pagar, y el
    // entrante se registraba con `obligacionId ?? ''` contra una columna uuid:
    // "invalid input syntax for type uuid". El mensaje de quien terminó de pagar
    // —el que suele traer el comprobante o el reclamo— se perdía entero.
    await base.db.query(`UPDATE obligaciones SET estado = 'pagada' WHERE tenant_id = $1`, [A])

    await procesarLote(unEntrante(TEL_A, 'wamid.PAGADO', 'ya quedé al día, gracias'))

    const bandeja = await listarBandeja(base.db, A, { usuarioId: USUARIO })
    expect(bandeja).toHaveLength(1)
    expect(bandeja[0].ultimoMensaje).toBe('ya quedé al día, gracias')

    // El contacto queda sin obligación, no con una inventada: la evidencia de
    // cumplimiento se cuenta por deudor, no por crédito.
    const [contacto] = await base.db.query<{ obligacion_id: string | null }>(
      `SELECT obligacion_id FROM contactos WHERE tenant_id = $1 AND direccion = 'entrante'`,
      [A],
    )
    expect(contacto.obligacion_id).toBeNull()
  })
})
