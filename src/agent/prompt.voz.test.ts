import { describe, expect, it } from 'vitest'
import type { Deudor, LimitesNegociacion, Obligacion } from '@/domain/types'
import { construirPrompt } from './prompt'

const DEUDOR: Deudor = {
  id: 'd1', clienteId: 'c1', tipoDocumento: 'CC', documento: '1020304050',
  nombre: 'Jorge Ospina', telefonos: ['+573001234567'], email: null, rol: 'titular',
  consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: null },
  preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
  numeroErradoEn: null,
}
const OBLIGACION: Obligacion = {
  id: 'o1', clienteId: 'c1', deudorId: 'd1', numeroCredito: 'CR-04471',
  capital: 1_760_000, interesMora: 80_000, saldoTotal: 1_840_000,
  fechaVencimiento: '2026-07-13', diasMora: 43, tramo: 'media', estado: 'en_mora',
}
const LIMITES: LimitesNegociacion = {
  descuentoMaxPct: 10, cuotasMax: 4, diasPlazoMax: 30, montoMinimoAbono: 100_000,
}
const base = { cliente: { nombre: 'Créditos del Valle' }, deudor: DEUDOR, obligacion: OBLIGACION, limites: LIMITES, fechaHoy: '2026-08-25' }

describe('construirPrompt', () => {
  it('sin canal se comporta como antes: WhatsApp', () => {
    const p = construirPrompt(base)
    expect(p).toContain('Atiendes por WhatsApp')
    expect(p).toContain('# Cómo escribes')
    expect(construirPrompt({ ...base, canal: 'whatsapp' })).toBe(p)
  })

  /**
   * Las tres reglas de WhatsApp que por voz hacen daño: el emoji se lee, las
   * viñetas no se oyen, y la URL no se puede dictar.
   */
  it('en voz prohíbe emojis y leer el link en voz alta', () => {
    const p = construirPrompt({ ...base, canal: 'voz' })
    expect(p).toContain('# Cómo hablas')
    expect(p).toContain('Cero emojis')
    expect(p).toContain('Nunca leas la dirección en voz alta')
    expect(p).toContain('se lo acabas de mandar por WhatsApp')
    expect(p).not.toContain('Atiendes por WhatsApp')
    expect(p).not.toContain('Un emoji como máximo')
  })

  it('en voz conserva los límites del cliente, que no dependen del canal', () => {
    const p = construirPrompt({ ...base, canal: 'voz' })
    expect(p).toContain('Hasta 4 cuotas')
    expect(p).toContain('escalarAHumano')
    expect(p).toContain('consultarCartera')
  })
})
