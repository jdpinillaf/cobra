import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  centavosAPesos,
  construirLinkDePago,
  construirReferencia,
  esAtribuibleAlAgente,
  esReferenciaValida,
  firmaIntegridad,
  interpretarEvento,
  pesosACentavos,
  verificarChecksumWebhook,
  type ConfigWompi,
  type EventoWompi,
} from './wompi'

const CONFIG: ConfigWompi = {
  llavePublica: 'pub_test_X0zDA9xoKdePzhd8a0x9HAez7HgGO2fH',
  secretoIntegridad: 'test_integrity_secreto',
  secretoEventos: 'test_events_secreto',
  urlRedireccion: 'https://cobra.example/gracias',
  ambiente: 'test',
}

describe('firmaIntegridad', () => {
  it('reproduce el vector publicado por Wompi', () => {
    // Ejemplo de la documentación oficial del Checkout Web.
    const firma = firmaIntegridad({
      referencia: 'sk8-438k4-xmxm392-sn2m2',
      montoEnCentavos: 490000,
      moneda: 'COP',
      secretoIntegridad: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
    })
    expect(firma).toBe('37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5')
  })

  it('incluye la expiración en la concatenación cuando está presente', () => {
    const base = {
      referencia: 'REF-1',
      montoEnCentavos: 100_000,
      secretoIntegridad: 's3cr3t',
    }
    const sinExpiracion = firmaIntegridad(base)
    const conExpiracion = firmaIntegridad({ ...base, expiraEn: '2026-08-20T12:00:00.000Z' })
    expect(conExpiracion).not.toBe(sinExpiracion)
    expect(conExpiracion).toBe(
      createHash('sha256')
        .update('REF-1100000COP2026-08-20T12:00:00.000Zs3cr3t', 'utf8')
        .digest('hex'),
    )
  })
})

describe('referencias', () => {
  it('genera una referencia con el prefijo de conciliación', () => {
    expect(construirReferencia('obl_1020304050_2', 'k3f9')).toBe('COB-obl_1020304050_2-k3f9')
  })

  it('limpia caracteres que Wompi rechaza', () => {
    expect(construirReferencia('obl/123 456', 'x1')).toBe('COB-obl123456-x1')
  })

  it.each([
    ['COB-obl_1-x', true],
    ['REF-123_456', true],
    ['ref con espacios', false],
    ['ref/barra', false],
    ['ref#hash', false],
  ])('valida "%s" → %s', (ref, esperado) => {
    expect(esReferenciaValida(ref)).toBe(esperado)
  })
})

describe('pesos y centavos', () => {
  it('convierte pesos colombianos a centavos y de vuelta', () => {
    expect(pesosACentavos(1_245_000)).toBe(124_500_000)
    expect(centavosAPesos(124_500_000)).toBe(1_245_000)
  })
})

describe('construirLinkDePago', () => {
  it('arma una URL de checkout firmada', () => {
    const link = construirLinkDePago(CONFIG, {
      referencia: 'COB-obl_1-a1',
      montoCop: 1_245_000,
      nombreCliente: 'Ana Ruiz',
      telefonoCliente: '+573001112233',
    })

    const url = new URL(link.url)
    expect(url.origin + url.pathname).toBe('https://checkout.wompi.co/p/')
    expect(url.searchParams.get('public-key')).toBe(CONFIG.llavePublica)
    expect(url.searchParams.get('currency')).toBe('COP')
    expect(url.searchParams.get('amount-in-cents')).toBe('124500000')
    expect(url.searchParams.get('reference')).toBe('COB-obl_1-a1')
    expect(url.searchParams.get('redirect-url')).toBe(CONFIG.urlRedireccion)
    expect(url.searchParams.get('customer-data:full-name')).toBe('Ana Ruiz')
    expect(url.searchParams.get('signature:integrity')).toBe(
      firmaIntegridad({
        referencia: 'COB-obl_1-a1',
        montoEnCentavos: 124_500_000,
        secretoIntegridad: CONFIG.secretoIntegridad,
      }),
    )
  })

  it('no expone el secreto de integridad en la URL', () => {
    const link = construirLinkDePago(CONFIG, { referencia: 'COB-x-1', montoCop: 50_000 })
    expect(link.url).not.toContain(CONFIG.secretoIntegridad)
  })

  it('rechaza referencias y montos inválidos antes de llamar a Wompi', () => {
    expect(() => construirLinkDePago(CONFIG, { referencia: 'con espacio', montoCop: 1000 })).toThrow(
      /Referencia inválida/,
    )
    expect(() => construirLinkDePago(CONFIG, { referencia: 'COB-x', montoCop: 0 })).toThrow(
      /Monto inválido/,
    )
    expect(() => construirLinkDePago(CONFIG, { referencia: 'COB-x', montoCop: -5 })).toThrow(
      /Monto inválido/,
    )
  })
})

/** Construye un evento con checksum correcto, como lo enviaría Wompi. */
function eventoFirmado(over: Partial<EventoWompi> = {}): EventoWompi {
  const data = {
    transaction: {
      id: '01-1532941443-49201',
      reference: 'COB-obl_1-a1',
      amount_in_cents: 124_500_000,
      status: 'APPROVED',
      currency: 'COP',
      payment_method_type: 'NEQUI',
    },
  }
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']
  const timestamp = 1_780_000_000
  const valores = '01-1532941443-49201APPROVED124500000'
  const checksum = createHash('sha256')
    .update(`${valores}${timestamp}${CONFIG.secretoEventos}`, 'utf8')
    .digest('hex')

  return {
    event: 'transaction.updated',
    data,
    environment: 'test',
    signature: { properties, checksum },
    timestamp,
    sent_at: '2026-08-11T15:00:00.000Z',
    ...over,
  }
}

describe('verificarChecksumWebhook', () => {
  it('acepta un evento legítimo', () => {
    expect(verificarChecksumWebhook(eventoFirmado(), CONFIG.secretoEventos)).toBe(true)
  })

  it('rechaza un evento con el monto alterado', () => {
    const evento = eventoFirmado()
    ;(evento.data.transaction as Record<string, unknown>).amount_in_cents = 100
    expect(verificarChecksumWebhook(evento, CONFIG.secretoEventos)).toBe(false)
  })

  it('rechaza un evento con estado falsificado a APPROVED', () => {
    const evento = eventoFirmado()
    ;(evento.data.transaction as Record<string, unknown>).status = 'DECLINED'
    expect(verificarChecksumWebhook(evento, CONFIG.secretoEventos)).toBe(false)
  })

  it('rechaza el secreto equivocado', () => {
    expect(verificarChecksumWebhook(eventoFirmado(), 'otro_secreto')).toBe(false)
  })

  it('rechaza un evento con timestamp modificado', () => {
    expect(verificarChecksumWebhook(eventoFirmado({ timestamp: 1 }), CONFIG.secretoEventos)).toBe(
      false,
    )
  })

  it('rechaza eventos sin firma en vez de lanzar', () => {
    const sinFirma = { ...eventoFirmado(), signature: undefined } as unknown as EventoWompi
    expect(verificarChecksumWebhook(sinFirma, CONFIG.secretoEventos)).toBe(false)
  })
})

describe('interpretarEvento', () => {
  it('traduce una transacción aprobada', () => {
    expect(interpretarEvento(eventoFirmado())).toEqual({
      referencia: 'COB-obl_1-a1',
      transaccionId: '01-1532941443-49201',
      estado: 'aprobado',
      montoCop: 1_245_000,
      metodoPago: 'NEQUI',
      ocurrioEn: '2026-08-11T15:00:00.000Z',
    })
  })

  it.each([
    ['APPROVED', 'aprobado'],
    ['DECLINED', 'declinado'],
    ['VOIDED', 'anulado'],
    ['PENDING', 'pendiente'],
    ['ERROR', 'error'],
    ['LO_QUE_SEA', 'error'],
  ])('mapea el estado %s → %s', (crudo, esperado) => {
    const evento = eventoFirmado()
    ;(evento.data.transaction as Record<string, unknown>).status = crudo
    expect(interpretarEvento(evento)?.estado).toBe(esperado)
  })

  it('ignora eventos que no son de transacción', () => {
    expect(interpretarEvento(eventoFirmado({ data: { nequi_token: {} } }))).toBeNull()
  })
})

describe('esAtribuibleAlAgente', () => {
  it('atribuye un pago dentro de los 7 días del contacto', () => {
    expect(esAtribuibleAlAgente('2026-08-14T10:00:00Z', '2026-08-11T10:00:00Z')).toBe(true)
    expect(esAtribuibleAlAgente('2026-08-18T09:59:00Z', '2026-08-11T10:00:00Z')).toBe(true)
  })

  it('no atribuye fuera de la ventana', () => {
    expect(esAtribuibleAlAgente('2026-08-19T10:00:00Z', '2026-08-11T10:00:00Z')).toBe(false)
  })

  it('no atribuye un pago anterior al contacto', () => {
    expect(esAtribuibleAlAgente('2026-08-10T10:00:00Z', '2026-08-11T10:00:00Z')).toBe(false)
  })

  it('no atribuye si el agente nunca contactó', () => {
    expect(esAtribuibleAlAgente('2026-08-14T10:00:00Z', null)).toBe(false)
  })
})
