import { describe, expect, it } from 'vitest'
import type { VentanaServicio } from '@/domain/types'
import { decidirEnvioManual } from './envio-manual'

/**
 * Qué puede escribir un asesor, y cuándo.
 *
 * WhatsApp solo acepta texto libre dentro de las 24 h que abre un mensaje del
 * deudor. Fuera de esa ventana exige una plantilla aprobada por Meta, y el
 * texto libre se rechaza con el error 131047: el mensaje que el asesor creyó
 * haber mandado no llega.
 *
 * La decisión vive acá, del lado del servidor, y no en el navegador. La UI
 * bloquea el textarea por comodidad; esto lo bloquea de verdad. Si la regla
 * viviera solo en el cliente, cualquier request directo la saltearía.
 */

const AHORA = new Date('2026-08-20T15:00:00-05:00')

const ventana = (expiraEn: string): VentanaServicio => ({
  clienteId: 'c1',
  deudorId: 'd1',
  abiertaEn: '2026-08-19T15:00:00-05:00',
  expiraEn,
})

const ABIERTA = ventana('2026-08-20T19:00:00-05:00')
const VENCIDA = ventana('2026-08-20T09:00:00-05:00')

describe('decidirEnvioManual', () => {
  it('deja escribir texto libre con la ventana abierta, y no cuesta nada', () => {
    const r = decidirEnvioManual({ ventana: ABIERTA, ahora: AHORA, plantilla: null, texto: 'listo' })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Dentro de la ventana Meta no cobra: es un mensaje de servicio.
    expect(r.categoria).toBe('servicio')
  })

  it('rechaza texto libre con la ventana vencida, antes de intentar el envío', () => {
    const r = decidirEnvioManual({ ventana: VENCIDA, ahora: AHORA, plantilla: null, texto: 'listo' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('requiere_plantilla')
    // La UI necesita saber desde cuándo está cerrada para explicarlo.
    expect(r.expiroEn).toBe(VENCIDA.expiraEn)
  })

  it('rechaza texto libre si el deudor nunca escribió', () => {
    // Sin ventana no hay ventana abierta. Es el caso del primer contacto.
    const r = decidirEnvioManual({ ventana: null, ahora: AHORA, plantilla: null, texto: 'hola' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('requiere_plantilla')
  })

  it('acepta una plantilla aprobada aunque la ventana esté vencida', () => {
    const r = decidirEnvioManual({
      ventana: VENCIDA,
      ahora: AHORA,
      plantilla: { id: 'p1', nombreMeta: 'recordatorio', categoria: 'utility', aprobada: true, variables: [] },
      texto: null,
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.categoria).toBe('utility')
  })

  it('cobra la plantilla por su categoría aunque la ventana esté abierta', () => {
    const r = decidirEnvioManual({
      ventana: ABIERTA,
      ahora: AHORA,
      plantilla: { id: 'p1', nombreMeta: 'promo', categoria: 'marketing', aprobada: true, variables: [] },
      texto: null,
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Meta cobra las plantillas siempre. Una `marketing` cuesta 25 veces una
    // `utility`, y suponer que adentro de la ventana es gratis subestima el
    // consumo del cupo mes a mes.
    expect(r.categoria).toBe('marketing')
  })

  it('rechaza una plantilla que Meta todavía no aprobó', () => {
    const r = decidirEnvioManual({
      ventana: VENCIDA,
      ahora: AHORA,
      plantilla: { id: 'p1', nombreMeta: null, categoria: 'utility', aprobada: false, variables: [] },
      texto: null,
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('plantilla_no_aprobada')
  })

  it('exige todas las variables de la plantilla', () => {
    const plantilla = {
      id: 'p1',
      nombreMeta: 'recordatorio',
      categoria: 'utility' as const,
      aprobada: true,
      variables: ['nombre', 'monto'],
    }

    // Mandarla incompleta hace que Meta la rechace o, peor, que llegue con un
    // hueco donde iba el monto.
    expect(decidirEnvioManual({ ventana: VENCIDA, ahora: AHORA, plantilla, texto: null, variables: ['Ana'] }).ok).toBe(false)
    expect(decidirEnvioManual({ ventana: VENCIDA, ahora: AHORA, plantilla, texto: null, variables: ['Ana', '$1.000'] }).ok).toBe(true)
  })

  it('rechaza un mensaje vacío o de solo espacios', () => {
    for (const texto of ['', '   ', '\n\t']) {
      expect(decidirEnvioManual({ ventana: ABIERTA, ahora: AHORA, plantilla: null, texto }).ok).toBe(false)
    }
  })

  it('rechaza un texto más largo de lo que WhatsApp acepta', () => {
    const r = decidirEnvioManual({
      ventana: ABIERTA,
      ahora: AHORA,
      plantilla: null,
      texto: 'a'.repeat(4097),
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('texto_muy_largo')
  })
})
