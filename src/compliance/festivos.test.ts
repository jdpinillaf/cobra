import { describe, expect, it } from 'vitest'
import { domingoDePascua, esFestivo, festivosColombia } from './festivos'

function claveUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10)
}

describe('domingoDePascua', () => {
  // Fechas de Pascua publicadas, para anclar el algoritmo gregoriano.
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2030, '2030-04-21'],
  ])('Pascua de %i cae el %s', (anio, esperado) => {
    expect(claveUtc(domingoDePascua(anio))).toBe(esperado)
  })
})

describe('festivosColombia', () => {
  // La ley define 18 festivos, pero el traslado al lunes puede hacer que dos
  // caigan en la misma fecha, así que el número de fechas distintas varía.
  it.each([2024, 2025, 2026, 2027, 2030])('%i tiene entre 16 y 18 fechas festivas', (anio) => {
    const total = festivosColombia(anio).size
    expect(total).toBeGreaterThanOrEqual(16)
    expect(total).toBeLessThanOrEqual(18)
  })

  it('2025: San Pedro y Sagrado Corazón colapsan en el mismo lunes', () => {
    // San Pedro y San Pablo cae domingo 29 de junio y se traslada al 30.
    // Sagrado Corazón (Pascua + 71) aterriza en ese mismo lunes 30.
    expect(esFestivo('2025-06-30')).toBe(true)
    expect(esFestivo('2025-06-29')).toBe(false)
    expect(festivosColombia(2025).size).toBe(17)
  })

  it('los festivos de Ley Emiliani caen siempre en lunes', () => {
    const trasladables = ['01-06', '03-19', '06-29', '08-15', '10-12', '11-01', '11-11']
    for (let anio = 2024; anio <= 2035; anio++) {
      const festivos = [...festivosColombia(anio)]
      for (const md of trasladables) {
        const [mes, dia] = md.split('-').map(Number)
        const original = new Date(Date.UTC(anio, mes - 1, dia))
        // El trasladado es el primer festivo en lunes dentro de los 6 días siguientes.
        const candidato = festivos.find((f) => {
          const d = new Date(`${f}T00:00:00Z`)
          const delta = (d.getTime() - original.getTime()) / 86_400_000
          return delta >= 0 && delta <= 6 && d.getUTCDay() === 1
        })
        expect(candidato, `${anio}-${md} debería trasladarse a un lunes`).toBeDefined()
      }
    }
  })

  it('los fijos no se mueven aunque caigan en domingo', () => {
    // 1-ene-2023 y 1-may-2022 cayeron domingo: siguen siendo festivos ese día,
    // y el lunes siguiente es hábil.
    expect(new Date('2023-01-01T00:00:00Z').getUTCDay()).toBe(0)
    expect(esFestivo('2023-01-01')).toBe(true)
    expect(esFestivo('2023-01-02')).toBe(false)

    expect(new Date('2022-05-01T00:00:00Z').getUTCDay()).toBe(0)
    expect(esFestivo('2022-05-01')).toBe(true)
    expect(esFestivo('2022-05-02')).toBe(false)
  })
})

describe('esFestivo — casos concretos de 2026', () => {
  it.each([
    ['2026-01-01', 'Año Nuevo'],
    ['2026-01-12', 'Reyes Magos trasladado desde el martes 6'],
    ['2026-03-23', 'San José trasladado desde el jueves 19'],
    ['2026-04-02', 'Jueves Santo'],
    ['2026-04-03', 'Viernes Santo'],
    ['2026-05-01', 'Día del Trabajo'],
    ['2026-05-18', 'Ascensión'],
    ['2026-06-08', 'Corpus Christi'],
    ['2026-06-15', 'Sagrado Corazón'],
    ['2026-06-29', 'San Pedro y San Pablo, ya cae lunes'],
    ['2026-07-20', 'Independencia'],
    ['2026-08-07', 'Batalla de Boyacá'],
    ['2026-08-17', 'Asunción trasladada desde el sábado 15'],
    ['2026-10-12', 'Día de la Raza, ya cae lunes'],
    ['2026-11-02', 'Todos los Santos trasladado desde el domingo 1'],
    ['2026-11-16', 'Independencia de Cartagena trasladada desde el miércoles 11'],
    ['2026-12-08', 'Inmaculada Concepción'],
    ['2026-12-25', 'Navidad'],
  ])('%s es festivo (%s)', (fecha) => {
    expect(esFestivo(fecha)).toBe(true)
  })

  it.each([
    '2026-01-06', // el original, ya trasladado
    '2026-03-19',
    '2026-08-15',
    '2026-11-01',
    '2026-11-11',
    '2026-04-01', // Miércoles Santo no es festivo en Colombia
    '2026-04-06', // Lunes de Pascua tampoco
    '2026-12-24',
    '2026-12-31',
    '2026-08-10',
  ])('%s NO es festivo', (fecha) => {
    expect(esFestivo(fecha)).toBe(false)
  })
})
