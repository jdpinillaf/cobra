import { describe, expect, it } from 'vitest'
import type { Deudor, LimitesNegociacion, Obligacion } from '@/domain/types'
import { MARCADOR_LINK, responderGuionado } from './guionado'

/**
 * El respaldo corre justo cuando algo ya salió mal, así que es el camino que
 * menos margen tiene para equivocarse. Estos tests fijan lo que no puede fallar:
 * que no dé datos a un tercero, que no ofrezca fuera de rango, y que cuando
 * anuncia un link deje el marcador para que exista uno de verdad.
 */

const DEUDOR: Deudor = {
  id: 'd1',
  clienteId: 'c1',
  tipoDocumento: 'CC',
  documento: '1024587963',
  nombre: 'Jorge Ospina',
  telefonos: ['+573001234567'],
  email: null,
  rol: 'titular',
  consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-11-04', revocadoEn: null },
  preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
  numeroErradoEn: null,
}

const OBLIGACION: Obligacion = {
  id: 'o1',
  clienteId: 'c1',
  deudorId: 'd1',
  numeroCredito: 'CR-04471',
  capital: 1_760_000,
  interesMora: 80_000,
  saldoTotal: 1_840_000,
  fechaVencimiento: '2026-07-01',
  diasMora: 43,
  tramo: 'media',
  estado: 'en_mora',
}

/** Los del tramo `media` del cliente demo. */
const LIMITES: LimitesNegociacion = {
  descuentoMaxPct: 10,
  cuotasMax: 4,
  diasPlazoMax: 30,
  montoMinimoAbono: 100_000,
}

const responder = (texto: string, over: Partial<Parameters<typeof responderGuionado>[1]> = {}) =>
  responderGuionado(texto, {
    deudor: DEUDOR,
    obligacion: OBLIGACION,
    limites: LIMITES,
    cuotaPactada: null,
    ...over,
  })

describe('responderGuionado', () => {
  it('propone cuotas cuando el deudor dice que no puede pagar todo', () => {
    const r = responder('No tengo cómo pagar todo de una')

    expect(r.accion).toEqual({ tipo: 'acuerdo', numeroCuotas: 2, montoTotal: 1_840_000 })
    expect(r.texto).toContain('CR-04471')
    expect(r.texto).toContain('2 cuotas')
  })

  it('pide el link con el marcador, para que se sustituya por uno real', () => {
    const r = responder('Listo, hagámosle en dos')

    expect(r.accion).toEqual({ tipo: 'link', montoCop: 920_000 })
    expect(r.texto).toContain(MARCADOR_LINK)
  })

  it('cobra la cuota pactada cuando ya hay acuerdo, no la mitad del saldo', () => {
    const r = responder('Mándeme el link', { cuotaPactada: 460_000 })

    expect(r.accion).toEqual({ tipo: 'link', montoCop: 460_000 })
  })

  // --- Lo que no puede pasar ---

  it('escala si piden más cuotas de las autorizadas, en vez de aceptar', () => {
    const r = responder('¿Y si me lo dejan en 8 cuotas?')

    expect(r.accion).toEqual({ tipo: 'escalar' })
    expect(r.texto).not.toContain('8 cuotas de')
  })

  it('lee las cuotas escritas en palabras', () => {
    expect(responder('me lo puede dejar en ocho cuotas').accion).toEqual({ tipo: 'escalar' })
  })

  it('acepta lo que sí cabe en el rango', () => {
    const r = responder('¿me lo puede partir en 3 cuotas?')

    expect(r.accion.tipo).toBe('acuerdo')
  })

  it('no le da ningún dato del crédito a quien dice no ser el titular', () => {
    const r = responder('Yo no soy Jorge, se equivocaron')

    expect(r.accion).toEqual({ tipo: 'escalar' })
    expect(r.texto).not.toContain('CR-04471')
    expect(r.texto).not.toContain('1.840.000')
    expect(r.texto).not.toContain('Jorge')
  })

  it('no discute cuando el deudor dice que ya pagó: escala', () => {
    const r = responder('Ya pagué eso')

    expect(r.accion).toEqual({ tipo: 'escalar' })
    expect(r.texto).toContain('cartera')
  })

  it('no ofrece descuento en un tramo que no lo autoriza', () => {
    const r = responder('¿me hacen un descuento?', {
      limites: { ...LIMITES, descuentoMaxPct: 0 },
    })

    expect(r.accion).toEqual({ tipo: 'escalar' })
    expect(r.texto).not.toMatch(/\d+%/)
  })

  it('ante algo que no entiende, escala en vez de improvisar', () => {
    const r = responder('oiga y ustedes tienen créditos de vivienda?')

    expect(r.accion).toEqual({ tipo: 'escalar' })
  })

  it('confirma la baja sin insistir', () => {
    const r = responder('no me contacten más')

    expect(r.accion).toEqual({ tipo: 'ninguna' })
    expect(r.texto).not.toContain('CR-04471')
  })
})
