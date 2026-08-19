import { describe, expect, it } from 'vitest'
import type { Contacto, Deudor, Obligacion } from '@/domain/types'
import { evaluarRespuesta } from './compuerta'

/**
 * Pausar al agente.
 *
 * Hoy hay un bug abierto: un asesor toma la conversación, el deudor responde, y
 * el bot le contesta encima. `estadoCaso='humano'` existe pero no se lee nunca
 * como condición para callar — la única lectura en el flujo solo promueve
 * estados. Dos voces en el mismo hilo es exactamente lo que el cliente está
 * tratando de evitar al dejar de cobrar desde los celulares de sus vendedores.
 *
 * La pausa se decide acá porque `evaluarRespuesta` ya es el único cuello donde
 * se resuelve si el agente habla. Y se mantiene **separada** del motivo legal:
 * mezclar una decisión operativa con el enum de la Ley 2300 ensuciaría la
 * evidencia que se le muestra a la SIC.
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
  modo?: 'agente' | 'humano'
} = {}) {
  return evaluarRespuesta({
    ahora: over.ahora ?? MARTES_10AM,
    deudor: over.deudor ?? unDeudor(),
    obligacion: over.obligacion ?? unaObligacion(),
    contactosDelDeudor: over.contactosDelDeudor ?? [],
    modo: over.modo,
  })
}

describe('pausa del agente', () => {
  it('calla cuando la conversación está en manos de un humano', () => {
    const r = evaluar({ modo: 'humano' })

    expect(r.responder).toBe(false)
    if (r.responder) return
    expect(r.razon).toBe('pausa')
  })

  it('sigue respondiendo cuando el modo es agente', () => {
    expect(evaluar({ modo: 'agente' }).responder).toBe(true)
  })

  it('el modo agente es el default, para no romper a quien todavía no lo pasa', () => {
    expect(evaluar({}).responder).toBe(true)
  })

  it('una pausa no es un bloqueo legal y no se reporta como tal', () => {
    const r = evaluar({ modo: 'humano' })

    if (r.responder) throw new Error('debería callar')
    // La distinción es el punto: `motivo` solo existe en la rama legal. Si la
    // pausa se colara ahí, un reporte de cumplimiento diría que la Ley 2300
    // bloqueó un contacto que en realidad frenó un asesor.
    expect('motivo' in r).toBe(false)
    expect(r.razon).toBe('pausa')
  })

  it('el motivo legal gana sobre la pausa cuando el deudor pidió la baja', () => {
    const r = evaluar({
      modo: 'humano',
      deudor: unDeudor({
        consentimiento: {
          otorgado: true,
          fuente: 'pagare',
          fecha: '2025-01-15',
          revocadoEn: '2026-08-01T10:00:00-05:00',
        },
      }),
    })

    if (r.responder) throw new Error('debería callar')
    // Los dos frenan al agente, pero solo uno es una obligación legal. El que
    // queda escrito tiene que ser el que importa ante un reclamo.
    expect(r.razon).toBe('ley')
    if (r.razon !== 'ley') return
    expect(r.motivo).toBe('opt_out')
  })

  it('la pausa también calla fuera de la ventana legal, donde el agente sí respondería', () => {
    // Un domingo a las 9pm el agente contesta igual: la ley limita cuándo se
    // contacta, no cuándo se responde. La pausa sí lo frena.
    expect(evaluar({ ahora: DOMINGO_9PM }).responder).toBe(true)
    expect(evaluar({ ahora: DOMINGO_9PM, modo: 'humano' }).responder).toBe(false)
  })
})
