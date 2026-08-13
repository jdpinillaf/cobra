import { describe, expect, it } from 'vitest'
import { RepositorioEnMemoria, procesarWebhook } from './procesador-webhook'

function payload(opciones: {
  entrantes?: Array<{ id: string; from: string; body: string; ts?: string }>
  estados?: Array<{ id: string; status: string; ts?: string }>
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1029',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              messages: (opciones.entrantes ?? []).map((m) => ({
                from: m.from,
                id: m.id,
                timestamp: m.ts ?? '1786000000',
                type: 'text',
                text: { body: m.body },
              })),
              statuses: (opciones.estados ?? []).map((s) => ({
                id: s.id,
                status: s.status,
                timestamp: s.ts ?? '1786000100',
              })),
            },
          },
        ],
      },
    ],
  }
}

describe('procesarWebhook', () => {
  it('registra el entrante y le abre la ventana de servicio', async () => {
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      payload({ entrantes: [{ id: 'wamid.1', from: '573009998877', body: '¿Cuánto debo?' }] }),
      repo,
    )

    expect(resumen.entrantesRegistrados).toBe(1)
    expect(repo.entrantes[0].cuerpo).toBe('¿Cuánto debo?')
    // Sin esta ventana no hay mensajes gratis: es todo el ahorro de la migración.
    expect(repo.ventanas.get('+573009998877')).toBeTruthy()
  })

  it('revoca el consentimiento cuando el deudor pide la baja', async () => {
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      payload({ entrantes: [{ id: 'wamid.2', from: '573009998877', body: 'BAJA' }] }),
      repo,
    )

    expect(resumen.optOuts).toBe(1)
    expect(repo.revocados.get('+573009998877')).toBeTruthy()
  })

  it('deja el mensaje de baja en el log: es la prueba de que se pidió', async () => {
    const repo = new RepositorioEnMemoria()
    await procesarWebhook(
      payload({ entrantes: [{ id: 'wamid.3', from: '573009998877', body: 'no me escriban' }] }),
      repo,
    )

    expect(repo.entrantes).toHaveLength(1)
    expect(repo.revocados.size).toBe(1)
  })

  it('no revoca por un "ya cancelé", que en Colombia significa que pagó', async () => {
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      payload({ entrantes: [{ id: 'wamid.4', from: '573009998877', body: 'ya cancelé la cuota' }] }),
      repo,
    )

    expect(resumen.optOuts).toBe(0)
    expect(repo.revocados.size).toBe(0)
  })

  it('es idempotente: Meta reintenta y el entrante no se cuenta dos veces', async () => {
    const repo = new RepositorioEnMemoria()
    const evento = payload({
      entrantes: [{ id: 'wamid.5', from: '573009998877', body: 'hola' }],
    })

    await procesarWebhook(evento, repo)
    const segunda = await procesarWebhook(evento, repo)

    // Sin dedupe, el cupo del cliente se cobra dos veces por el mismo mensaje.
    expect(segunda.entrantesRegistrados).toBe(0)
    expect(segunda.duplicadosIgnorados).toBe(1)
    expect(repo.entrantes).toHaveLength(1)
  })

  it('aplica la progresión de estados del mismo mensaje, no solo el primero', async () => {
    const repo = new RepositorioEnMemoria()

    await procesarWebhook(payload({ estados: [{ id: 'wamid.9', status: 'sent' }] }), repo)
    await procesarWebhook(payload({ estados: [{ id: 'wamid.9', status: 'delivered' }] }), repo)
    await procesarWebhook(payload({ estados: [{ id: 'wamid.9', status: 'read' }] }), repo)
    // Y el reintento del mismo estado sí se ignora.
    const repetido = await procesarWebhook(
      payload({ estados: [{ id: 'wamid.9', status: 'read' }] }),
      repo,
    )

    expect(repo.estados.map((e) => e.estado)).toEqual(['enviado', 'entregado', 'leido'])
    expect(repetido.duplicadosIgnorados).toBe(1)
  })

  it('un payload sin nada que hacer no rompe', async () => {
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook({ entry: [] }, repo)

    expect(resumen).toEqual({
      estadosAplicados: 0,
      entrantesRegistrados: 0,
      optOuts: 0,
      duplicadosIgnorados: 0,
    })
  })
})
