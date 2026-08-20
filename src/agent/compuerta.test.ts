import { describe, expect, it } from 'vitest'
import type { Contacto, Deudor, Obligacion } from '@/domain/types'
import { evaluarRespuesta } from './compuerta'

/**
 * Calendario de referencia (hora de Bogotá):
 *   mar 11 ago 2026 · dom 16 ago 2026
 */
const MARTES_10AM = new Date('2026-08-11T10:00:00-05:00')
const DOMINGO_9PM = new Date('2026-08-16T21:00:00-05:00')

function unDeudor(over: Partial<Deudor> = {}): Deudor {
  return {
    id: 'd1',
    clienteId: 'c1',
    tipoDocumento: 'CC',
    documento: '1020304050',
    nombre: 'Ana Ruiz',
    telefonos: ['+573001112233'],
    email: null,
    rol: 'titular',
    consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: null },
    preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
    numeroErradoEn: null,
    ...over,
  }
}

function unaObligacion(over: Partial<Obligacion> = {}): Obligacion {
  return {
    id: 'o1',
    clienteId: 'c1',
    deudorId: 'd1',
    numeroCredito: 'CR-001',
    capital: 1_200_000,
    interesMora: 45_000,
    saldoTotal: 1_245_000,
    fechaVencimiento: '2026-07-20',
    diasMora: 22,
    tramo: 'temprana',
    estado: 'en_mora',
    ...over,
  }
}

function evaluar(over: {
  ahora?: Date
  deudor?: Deudor
  obligacion?: Obligacion
  contactosDelDeudor?: Contacto[]
} = {}) {
  return evaluarRespuesta({
    ahora: over.ahora ?? MARTES_10AM,
    deudor: over.deudor ?? unDeudor(),
    obligacion: over.obligacion ?? unaObligacion(),
    contactosDelDeudor: over.contactosDelDeudor ?? [],
  })
}

describe('evaluarRespuesta', () => {
  it('responde dentro de la ventana legal', () => {
    const resultado = evaluar()
    expect(resultado.responder).toBe(true)
  })

  /**
   * El caso que motiva que esta función exista aparte del guard: si el deudor
   * escribe un domingo a las nueve de la noche preguntando cómo paga, dejarlo
   * sin respuesta no protege a nadie. La Ley 2300 limita cuándo la empresa
   * contacta, no cuándo responde.
   */
  it('responde un domingo de noche, aunque el guard bloquearía un envío propio', () => {
    const resultado = evaluar({ ahora: DOMINGO_9PM })

    expect(resultado.responder).toBe(true)
    if (!resultado.responder) throw new Error('inalcanzable')
    expect(resultado.decision.permitido).toBe(false)
    expect(resultado.nota).toContain('respuesta')
  })

  it('responde aunque el cupo semanal esté agotado', () => {
    const previos: Contacto[] = Array.from({ length: 3 }, (_, i) => ({
      id: `c${i}`,
      clienteId: 'c1',
      obligacionId: 'o1',
      deudorId: 'd1',
      canal: 'whatsapp',
      direccion: 'saliente',
      timestamp: new Date(MARTES_10AM.getTime() - (i + 1) * 3_600_000).toISOString(),
      plantillaId: 'p1',
      cuerpo: '',
      resultado: 'entregado',
      motivoBloqueo: null,
      costoCop: 3.2,
      idProveedor: `wamid.${i}`,
      proveedor: 'meta',
    }))

    expect(evaluar({ contactosDelDeudor: previos }).responder).toBe(true)
  })

  // --- Las que sí callan al agente ---

  it('calla si el deudor revocó el consentimiento', () => {
    const deudor = unDeudor({
      consentimiento: {
        otorgado: true,
        fuente: 'pagare',
        fecha: '2025-01-15',
        revocadoEn: '2026-08-01T10:00:00-05:00',
      },
    })
    const resultado = evaluar({ deudor })

    expect(resultado.responder).toBe(false)
    if (resultado.responder || resultado.razon !== 'ley') throw new Error('inalcanzable')
    expect(resultado.motivo).toBe('opt_out')
  })

  it('calla si nunca hubo consentimiento', () => {
    const deudor = unDeudor({
      consentimiento: { otorgado: false, fuente: 'importado', fecha: '2025-01-15', revocadoEn: null },
    })
    const resultado = evaluar({ deudor })

    expect(resultado.responder).toBe(false)
    if (resultado.responder || resultado.razon !== 'ley') throw new Error('inalcanzable')
    expect(resultado.motivo).toBe('sin_consentimiento')
  })

  it('calla si quien escribe es una referencia, no el deudor', () => {
    const resultado = evaluar({ deudor: unDeudor({ rol: 'referencia' }) })

    expect(resultado.responder).toBe(false)
    if (resultado.responder || resultado.razon !== 'ley') throw new Error('inalcanzable')
    expect(resultado.motivo).toBe('destinatario_es_referencia')
  })

  it('calla si la obligación ya está pagada', () => {
    const resultado = evaluar({ obligacion: unaObligacion({ estado: 'pagada' }) })

    expect(resultado.responder).toBe(false)
    if (resultado.responder || resultado.razon !== 'ley') throw new Error('inalcanzable')
    expect(resultado.motivo).toBe('obligacion_cerrada')
  })
})

describe('número que no corresponde', () => {
  it('el agente calla aunque el mensaje entrante sea justo el aviso', () => {
    // El caso es contraintuitivo y por eso vale el test: el deudor —quien sea
    // que conteste— acaba de escribir, así que la ventana está abierta y el
    // agente podría responder. Pero lo que escribió fue que no es él, y
    // contestarle es seguir gestionando una cartera contra un tercero.
    const compuerta = evaluarRespuesta({
      ahora: new Date('2026-08-11T10:00:00-05:00'),
      deudor: unDeudor({ numeroErradoEn: '2026-08-11T09:59:00-05:00' }),
      obligacion: unaObligacion(),
      contactosDelDeudor: [],
    })

    expect(compuerta.responder).toBe(false)
    if (compuerta.responder) return
    expect(compuerta.razon).toBe('ley')
    if (compuerta.razon !== 'ley') return
    expect(compuerta.motivo).toBe('numero_no_corresponde')
  })
})
