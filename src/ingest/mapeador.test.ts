import { describe, expect, it } from 'vitest'
import { detectarMapeo, faltantes, normalizarFilas, type MapeoColumnas } from './mapeador'

/** Encabezados tomados del tipo de archivo que manda un prestamista real. */
const ENCABEZADOS_REALES = [
  'CÉDULA',
  'NOMBRE DEL CLIENTE',
  'CELULAR',
  'Nro Crédito',
  'Saldo Total',
  'Capital',
  'Fecha Vencimiento',
]

describe('detectarMapeo', () => {
  it('reconoce encabezados en español con tildes, mayúsculas y espacios', () => {
    const mapeo = detectarMapeo(ENCABEZADOS_REALES)
    expect(mapeo).toMatchObject({
      documento: 'CÉDULA',
      nombre: 'NOMBRE DEL CLIENTE',
      telefono: 'CELULAR',
      numeroCredito: 'Nro Crédito',
      saldoTotal: 'Saldo Total',
      capital: 'Capital',
      fechaVencimiento: 'Fecha Vencimiento',
    })
    expect(faltantes(mapeo)).toEqual([])
  })

  it('no asigna la misma columna a dos campos', () => {
    const mapeo = detectarMapeo(['Documento', 'Nombre', 'Celular', 'Saldo', 'Vencimiento'])
    const asignadas = Object.values(mapeo)
    expect(new Set(asignadas).size).toBe(asignadas.length)
  })

  it('reporta los campos obligatorios que no encontró', () => {
    const mapeo = detectarMapeo(['Cedula', 'Nombre'])
    expect(faltantes(mapeo).sort()).toEqual(['fechaVencimiento', 'saldoTotal', 'telefono'])
  })

  it('distingue capital de saldo total', () => {
    const mapeo = detectarMapeo(['Saldo Capital', 'Saldo Total'])
    expect(mapeo.capital).toBe('Saldo Capital')
    expect(mapeo.saldoTotal).toBe('Saldo Total')
  })
})

const MAPEO: MapeoColumnas = {
  documento: 'CÉDULA',
  nombre: 'NOMBRE DEL CLIENTE',
  telefono: 'CELULAR',
  numeroCredito: 'Nro Crédito',
  saldoTotal: 'Saldo Total',
  capital: 'Capital',
  fechaVencimiento: 'Fecha Vencimiento',
}

const OPCIONES = { clienteId: 'c1', fechaCorte: '2026-08-11' }

function fila(over: Record<string, unknown> = {}) {
  return {
    'CÉDULA': '1.020.304.050',
    'NOMBRE DEL CLIENTE': 'Ana Ruiz',
    CELULAR: '300 111 2233',
    'Nro Crédito': 'CR-001',
    'Saldo Total': '$1.245.000',
    Capital: '1.200.000',
    'Fecha Vencimiento': '20/07/2026',
    ...over,
  }
}

describe('normalizarFilas', () => {
  it('convierte una fila sucia al modelo canónico', () => {
    const r = normalizarFilas([fila()], MAPEO, OPCIONES)

    expect(r.cuarentena).toHaveLength(0)
    expect(r.deudores).toHaveLength(1)
    expect(r.deudores[0]).toMatchObject({
      documento: '1020304050',
      nombre: 'Ana Ruiz',
      telefonos: ['+573001112233'],
      tipoDocumento: 'CC',
    })
    expect(r.obligaciones[0]).toMatchObject({
      numeroCredito: 'CR-001',
      saldoTotal: 1_245_000,
      capital: 1_200_000,
      fechaVencimiento: '2026-07-20',
      diasMora: 22,
      tramo: 'temprana',
      estado: 'en_mora',
    })
  })

  it('manda a cuarentena la fila mala sin tumbar la carga', () => {
    const filas = [
      fila(),
      fila({ 'CÉDULA': '9.999.999', CELULAR: 'no tiene' }),
      fila({ 'CÉDULA': '8.888.888', 'Saldo Total': 'pendiente' }),
      fila({ 'CÉDULA': '7.777.777' }),
    ]
    const r = normalizarFilas(filas, MAPEO, OPCIONES)

    expect(r.obligaciones).toHaveLength(2)
    expect(r.cuarentena).toHaveLength(2)
    expect(r.cuarentena[0].numeroFila).toBe(3)
    expect(r.cuarentena[0].errores[0]).toMatch(/teléfono/)
    expect(r.cuarentena[1].errores[0]).toMatch(/saldo/)
  })

  it('fusiona el mismo documento en un solo deudor con varias obligaciones', () => {
    const filas = [
      fila({ 'Nro Crédito': 'CR-001' }),
      fila({ 'Nro Crédito': 'CR-002', 'Saldo Total': '500.000' }),
    ]
    const r = normalizarFilas(filas, MAPEO, OPCIONES)

    expect(r.deudores).toHaveLength(1)
    expect(r.obligaciones).toHaveLength(2)
    expect(r.duplicadosFusionados).toBe(1)
    expect(r.obligaciones.map((o) => o.deudorId)).toEqual(['deu_1020304050', 'deu_1020304050'])
  })

  it('acumula los teléfonos distintos del mismo deudor', () => {
    const filas = [fila(), fila({ CELULAR: '3019998877' })]
    const r = normalizarFilas(filas, MAPEO, OPCIONES)
    expect(r.deudores[0].telefonos).toEqual(['+573001112233', '+573019998877'])
  })

  it('usa el teléfono alterno cuando el principal es inválido', () => {
    const mapeo = { ...MAPEO, telefonoAlterno: 'Celular 2' }
    const filas = [fila({ CELULAR: '123', 'Celular 2': '3019998877' })]
    const r = normalizarFilas(filas, mapeo, OPCIONES)

    expect(r.cuarentena).toHaveLength(0)
    expect(r.deudores[0].telefonos).toEqual(['+573019998877'])
  })

  it('clasifica el tramo según los días de mora a la fecha de corte', () => {
    const filas = [
      fila({ 'CÉDULA': '1', 'Fecha Vencimiento': '20/08/2026' }), // aún no vence
      fila({ 'CÉDULA': '2', 'Fecha Vencimiento': '01/08/2026' }), // 10 días
      fila({ 'CÉDULA': '3', 'Fecha Vencimiento': '01/07/2026' }), // 41 días
      fila({ 'CÉDULA': '4', 'Fecha Vencimiento': '01/01/2026' }), // 222 días
    ]
    const r = normalizarFilas(filas, MAPEO, OPCIONES)
    expect(r.obligaciones.map((o) => o.tramo)).toEqual([
      'preventiva',
      'temprana',
      'media',
      'castigada',
    ])
    expect(r.obligaciones[0].estado).toBe('al_dia')
  })

  it('rechaza saldos en cero: no hay nada que cobrar', () => {
    const r = normalizarFilas([fila({ 'Saldo Total': '0' })], MAPEO, OPCIONES)
    expect(r.cuarentena).toHaveLength(1)
    expect(r.cuarentena[0].errores[0]).toMatch(/nada que cobrar/)
  })

  it('marca el consentimiento como importado, no como opt-in explícito', () => {
    const r = normalizarFilas([fila()], MAPEO, OPCIONES)
    expect(r.deudores[0].consentimiento).toMatchObject({
      otorgado: true,
      fuente: 'importado',
      revocadoEn: null,
    })
  })
})
