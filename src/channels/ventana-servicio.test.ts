import { describe, expect, it } from 'vitest'
import { abrirVentana, categoriaDelEnvio, estaAbierta, requierePlantilla } from './ventana-servicio'
import { TARIFA_META } from './tarifas'

const ENTRANTE = '2026-08-11T10:00:00.000Z'
const ventana = abrirVentana({ clienteId: 'c1', deudorId: 'd1', entranteEn: ENTRANTE })

const enHoras = (h: number): Date => new Date(Date.parse(ENTRANTE) + h * 3_600_000)

describe('abrirVentana', () => {
  it('expira exactamente 24 horas después del entrante', () => {
    expect(ventana.expiraEn).toBe('2026-08-12T10:00:00.000Z')
  })

  it('cada entrante nuevo reinicia el reloj', () => {
    const renovada = abrirVentana({
      clienteId: 'c1',
      deudorId: 'd1',
      entranteEn: '2026-08-11T22:00:00.000Z',
    })
    expect(renovada.expiraEn).toBe('2026-08-12T22:00:00.000Z')
  })
})

describe('estaAbierta', () => {
  it('sigue abierta justo antes de las 24 h', () => {
    expect(estaAbierta(ventana, enHoras(23.99))).toBe(true)
  })

  it('está cerrada al cumplirse las 24 h', () => {
    expect(estaAbierta(ventana, enHoras(24))).toBe(false)
  })

  it('sin ventana previa está cerrada: el deudor nunca escribió', () => {
    expect(estaAbierta(null, enHoras(0))).toBe(false)
  })
})

describe('requierePlantilla', () => {
  it('fuera de la ventana exige plantilla aprobada', () => {
    // Mandar texto libre ahí falla con 131047 y el intento se pierde.
    expect(requierePlantilla(ventana, enHoras(25))).toBe(true)
  })

  it('dentro de la ventana admite texto libre', () => {
    expect(requierePlantilla(ventana, enHoras(1))).toBe(false)
  })
})

describe('categoriaDelEnvio', () => {
  it('dentro de la ventana y sin plantilla, es servicio y vale cero', () => {
    const categoria = categoriaDelEnvio({
      ventana,
      ahora: enHoras(2),
      categoriaDePlantilla: null,
    })

    expect(categoria).toBe('servicio')
    expect(TARIFA_META.costoCop('whatsapp', categoria)).toBe(0)
  })

  it('una plantilla se cobra por su categoría aunque la ventana esté abierta', () => {
    // Meta cobra las plantillas siempre. La ventana solo libera el texto libre.
    const categoria = categoriaDelEnvio({
      ventana,
      ahora: enHoras(2),
      categoriaDePlantilla: 'marketing',
    })

    expect(categoria).toBe('marketing')
    expect(TARIFA_META.costoCop('whatsapp', categoria)).toBeGreaterThan(0)
  })

  it('fuera de la ventana y sin plantilla declarada, se asume utility', () => {
    expect(
      categoriaDelEnvio({ ventana, ahora: enHoras(30), categoriaDePlantilla: null }),
    ).toBe('utility')
  })
})
