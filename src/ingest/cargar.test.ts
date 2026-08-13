import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { detectarFormato, leerArchivo, leerCsv, leerXlsx } from './cargar'
import { detectarMapeo, normalizarFilas, type MapeoColumnas } from './mapeador'

describe('detectarFormato', () => {
  it.each([
    ['cartera.csv', 'csv'],
    ['CARTERA.CSV', 'csv'],
    ['cartera.xlsx', 'xlsx'],
    ['cartera.xls', 'xlsx'],
    ['cartera.pdf', null],
    ['cartera', null],
  ])('%s → %s', (nombre, esperado) => {
    expect(detectarFormato(nombre)).toBe(esperado)
  })
})

describe('leerCsv', () => {
  it('lee un CSV separado por comas', () => {
    const csv = 'Cedula,Nombre,Celular\n1020304050,Ana Ruiz,3001112233\n'
    const r = leerCsv(csv)
    expect(r.encabezados).toEqual(['Cedula', 'Nombre', 'Celular'])
    expect(r.filas).toHaveLength(1)
    expect(r.filas[0].Nombre).toBe('Ana Ruiz')
  })

  it('autodetecta el punto y coma, común en exports colombianos', () => {
    const csv = 'Cedula;Nombre;Saldo\n1020304050;Ana Ruiz;1.245.000\n'
    const r = leerCsv(csv)
    expect(r.encabezados).toEqual(['Cedula', 'Nombre', 'Saldo'])
    expect(r.filas[0].Saldo).toBe('1.245.000')
  })

  it('recorta espacios de los encabezados y descarta filas en blanco', () => {
    const csv = ' Cedula , Nombre \n1020304050,Ana Ruiz\n\n,\n'
    const r = leerCsv(csv)
    expect(r.encabezados).toEqual(['Cedula', 'Nombre'])
    expect(r.filas).toHaveLength(1)
  })
})

/** Construye un .xlsx en memoria para no depender de un fixture binario. */
function xlsxDePrueba(filas: unknown[][], nombreHoja = 'Cartera'): Uint8Array {
  const hoja = XLSX.utils.aoa_to_sheet(filas)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja)
  return XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

describe('leerXlsx', () => {
  it('lee la primera hoja y conserva el orden de las columnas', () => {
    const buf = xlsxDePrueba([
      ['CÉDULA', 'NOMBRE DEL CLIENTE', 'CELULAR', 'Saldo Total', 'Fecha Vencimiento'],
      ['1020304050', 'Ana Ruiz', '3001112233', 1_245_000, '20/07/2026'],
    ])
    const r = leerXlsx(buf)
    expect(r.encabezados).toEqual([
      'CÉDULA',
      'NOMBRE DEL CLIENTE',
      'CELULAR',
      'Saldo Total',
      'Fecha Vencimiento',
    ])
    expect(r.filas).toHaveLength(1)
    expect(r.hoja).toBe('Cartera')
  })

  it('falla con mensaje claro si se pide una hoja que no existe', () => {
    const buf = xlsxDePrueba([['A'], [1]])
    expect(() => leerXlsx(buf, 'Inexistente')).toThrow(/no tiene la hoja/)
  })
})

describe('leerArchivo → mapeo → normalización, de punta a punta', () => {
  it('convierte un Excel sucio en cartera lista para cobrar', () => {
    const buf = xlsxDePrueba([
      ['CÉDULA', 'NOMBRE DEL CLIENTE', 'CELULAR', 'Nro Crédito', 'Saldo Total', 'Fecha Vencimiento'],
      ['1.020.304.050', 'Ana Ruiz', '300 111 2233', 'CR-001', '$1.245.000', '20/07/2026'],
      ['1.020.304.050', 'Ana Ruiz', '300 111 2233', 'CR-002', '500.000', '01/08/2026'],
      ['80.123.456', 'Luis Pérez', '6012345678', 'CR-003', '900.000', '15/07/2026'],
      ['70.999.888', 'Sin Saldo', '3019998877', 'CR-004', 'pendiente', '15/07/2026'],
    ])

    const archivo = leerArchivo('cartera.xlsx', buf)
    const mapeo = detectarMapeo(archivo.encabezados)
    const r = normalizarFilas(archivo.filas, mapeo as MapeoColumnas, {
      clienteId: 'c1',
      fechaCorte: '2026-08-11',
    })

    // Ana aporta dos créditos y un solo deudor.
    expect(r.deudores).toHaveLength(1)
    expect(r.obligaciones).toHaveLength(2)
    expect(r.duplicadosFusionados).toBe(1)

    // Luis quedó fuera por tener un fijo, y "Sin Saldo" por el monto ilegible.
    expect(r.cuarentena).toHaveLength(2)
    expect(r.cuarentena.map((c) => c.errores[0])).toEqual([
      expect.stringMatching(/teléfono/),
      expect.stringMatching(/saldo/),
    ])
  })

  it('rechaza formatos que no son de cartera', () => {
    expect(() => leerArchivo('informe.pdf', 'x')).toThrow(/Formato no soportado/)
  })
})
