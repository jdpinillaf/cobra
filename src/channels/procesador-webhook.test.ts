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
      numerosErrados: 0,
      duplicadosIgnorados: 0,
      aResponder: [],
    })
  })
})

describe('una ráfaga del deudor es un solo turno', () => {
  it('la respuesta sale al número desde el que escribió, no al primero de la cartera', async () => {
    // `deudores.telefonos` es un array y el webhook matchea cualquiera. Si el
    // deudor escribió desde el segundo, contestarle al primero manda las cifras
    // de su deuda a un teléfono que no escribió — en cartera importada, casi
    // siempre un familiar o una referencia.
    const repo = new RepositorioEnMemoria()
    repo.registrarEntrante = async () => ({ conversacionId: 'hilo-unico' })

    const resumen = await procesarWebhook(
      payload({ entrantes: [{ id: 'wamid.30', from: '573004445566', body: 'hola' }] }),
      repo,
    )

    expect(resumen.aResponder[0].telefono).toBe('+573004445566')
  })

  it('dos mensajes del mismo deudor en un POST dejan un solo hilo por responder', async () => {
    // Meta entrega `value.messages[]` como array: el deudor manda "hola" y
    // enseguida "cuánto debo", y las dos llegan en la misma entrega. Los dos
    // wamid son distintos, así que la idempotencia no los toca — y los dos
    // caían en el mismo hilo, porque `abrirOReutilizar` reusa el abierto.
    //
    // Sin deduplicar, el agente contesta dos veces: dos mensajes al deudor, dos
    // turnos de modelo cobrados, y la posibilidad de dos acuerdos o dos links
    // de pago para la misma obligación.
    const repo = new RepositorioEnMemoria()
    // El repo en memoria no resuelve hilos; se fuerza el mismo id para el caso.
    repo.registrarEntrante = async () => ({ conversacionId: 'hilo-unico' })

    const resumen = await procesarWebhook(
      payload({
        entrantes: [
          { id: 'wamid.10', from: '573009998877', body: 'hola' },
          { id: 'wamid.11', from: '573009998877', body: 'cuánto debo' },
        ],
      }),
      repo,
    )

    // Los dos entrantes se registran: los dos son evidencia y los dos van al hilo.
    expect(resumen.entrantesRegistrados).toBe(2)
    // Pero se responde una sola vez, con los dos mensajes ya en el contexto.
    expect(resumen.aResponder).toEqual([
      { conversacionId: 'hilo-unico', telefono: '+573009998877' },
    ])
  })

  it('dos deudores distintos en el mismo lote sí son dos turnos', async () => {
    const repo = new RepositorioEnMemoria()
    const porTelefono: Record<string, string> = {
      '+573009998877': 'hilo-a',
      '+573001112233': 'hilo-b',
    }
    repo.registrarEntrante = async (m) => ({ conversacionId: porTelefono[m.deTelefono] })

    const resumen = await procesarWebhook(
      payload({
        entrantes: [
          { id: 'wamid.20', from: '573009998877', body: 'hola' },
          { id: 'wamid.21', from: '573001112233', body: 'hola' },
        ],
      }),
      repo,
    )

    expect(resumen.aResponder).toEqual([
      { conversacionId: 'hilo-a', telefono: '+573009998877' },
      { conversacionId: 'hilo-b', telefono: '+573001112233' },
    ])
  })
})

describe('número que no corresponde', () => {
  const dice = (id: string, body: string) =>
    payload({ entrantes: [{ id, from: '573009998877', body }] })

  it('marca al deudor cuando alguien avisa que el número no es suyo', async () => {
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      dice('wamid.20', 'yo no soy, ese número está equivocado'),
      repo,
    )

    expect(resumen.numerosErrados).toBe(1)
    expect(repo.numerosErrados.get('+573009998877')).toBeTruthy()
  })

  it('registra el entrante igual, porque es la prueba de que lo avisó', async () => {
    // Mismo orden que el opt-out y por el mismo motivo: primero queda el
    // mensaje en el log, después se actúa sobre él. Si se marcara antes y el
    // proceso se cayera en el medio, quedaría un deudor frenado sin el mensaje
    // que lo explica.
    const repo = new RepositorioEnMemoria()
    await procesarWebhook(dice('wamid.21', 'este no es mi número'), repo)

    expect(repo.entrantes).toHaveLength(1)
    expect(repo.entrantes[0].cuerpo).toBe('este no es mi número')
  })

  it('no se dispara con "no soy capaz de pagar"', async () => {
    // En Colombia "no soy capaz" quiere decir *no puedo*. Frenarle la gestión al
    // deudor que está diciendo que no le alcanza es el falso positivo que más
    // caro sale.
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      dice('wamid.22', 'no soy capaz de pagar todo este mes'),
      repo,
    )

    expect(resumen.numerosErrados).toBe(0)
    expect(repo.numerosErrados.size).toBe(0)
  })

  it('un mensaje puede ser baja y número errado a la vez', async () => {
    // No compiten: uno revoca la autorización y el otro abre una revisión.
    const repo = new RepositorioEnMemoria()
    const resumen = await procesarWebhook(
      dice('wamid.23', 'no es mi número, no me escriban más'),
      repo,
    )

    expect(resumen.optOuts).toBe(1)
    expect(resumen.numerosErrados).toBe(1)
  })
})
