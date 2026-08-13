import { describe, expect, it } from 'vitest'
import { TICKET_PROMEDIO_POR_DEFECTO, generarCartera } from './seed'

const OPCIONES = { cantidad: 800, fechaCorte: '2026-08-11', semilla: 11 }

function promedioCapital(ticketPromedioCop?: number): number {
  const { obligaciones } = generarCartera({ ...OPCIONES, ticketPromedioCop })
  return obligaciones.reduce((s, o) => s + o.capital, 0) / obligaciones.length
}

describe('ticket promedio', () => {
  it('usa COP 1,2M cuando no se especifica', () => {
    expect(promedioCapital()).toBeCloseTo(TICKET_PROMEDIO_POR_DEFECTO, -5)
  })

  it.each([300_000, 1_200_000, 3_000_000, 5_000_000])(
    'produce una cartera que promedia cerca de COP %i',
    (ticket) => {
      const promedio = promedioCapital(ticket)
      // ±8% sobre 800 obligaciones: suficiente para detectar un error de escala
      // sin volverse frágil por el muestreo.
      expect(promedio).toBeGreaterThan(ticket * 0.92)
      expect(promedio).toBeLessThan(ticket * 1.08)
    },
  )

  it('mantiene la dispersión: no todas las obligaciones valen lo mismo', () => {
    const { obligaciones } = generarCartera({ ...OPCIONES, ticketPromedioCop: 1_000_000 })
    const capitales = obligaciones.map((o) => o.capital)
    expect(Math.min(...capitales)).toBeLessThan(600_000)
    expect(Math.max(...capitales)).toBeGreaterThan(1_400_000)
  })

  it('nunca genera capital negativo ni cero, por bajo que sea el ticket', () => {
    const { obligaciones } = generarCartera({ ...OPCIONES, ticketPromedioCop: 1_000 })
    expect(obligaciones.every((o) => o.capital > 0)).toBe(true)
    expect(obligaciones.every((o) => o.saldoTotal >= o.capital)).toBe(true)
  })

  it('sigue siendo determinista con el ticket parametrizado', () => {
    const a = generarCartera({ ...OPCIONES, ticketPromedioCop: 2_500_000 })
    const b = generarCartera({ ...OPCIONES, ticketPromedioCop: 2_500_000 })
    expect(a.obligaciones).toEqual(b.obligaciones)
  })

  it('el interés de mora escala con el capital', () => {
    const bajo = generarCartera({ ...OPCIONES, ticketPromedioCop: 500_000 })
    const alto = generarCartera({ ...OPCIONES, ticketPromedioCop: 5_000_000 })
    const suma = (c: typeof bajo) => c.obligaciones.reduce((s, o) => s + o.interesMora, 0)
    expect(suma(alto)).toBeGreaterThan(suma(bajo) * 5)
  })
})
