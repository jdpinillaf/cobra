import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { Fila } from './mapeador'

/**
 * Lectura de archivos de cartera.
 *
 * Devuelve filas crudas y encabezados sin interpretarlos: el mapeo y la
 * normalización viven en `mapeador.ts`. Separarlos permite mostrarle al gestor
 * una vista previa del archivo antes de que confirme el mapeo.
 */

export interface ArchivoLeido {
  encabezados: string[]
  filas: Fila[]
  /** Nombre de la hoja usada, cuando el archivo es un Excel con varias. */
  hoja: string | null
  hojasDisponibles: string[]
}

export type FormatoArchivo = 'csv' | 'xlsx'

export function detectarFormato(nombreArchivo: string): FormatoArchivo | null {
  const ext = nombreArchivo.toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'txt') return 'csv'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return 'xlsx'
  return null
}

/**
 * Lee un CSV.
 *
 * El delimitador se autodetecta: los exports colombianos usan punto y coma con
 * la misma frecuencia que coma, porque la coma ya está ocupada como separador
 * decimal en la configuración regional.
 */
export function leerCsv(contenido: string): ArchivoLeido {
  const parsed = Papa.parse<Record<string, unknown>>(contenido, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  const encabezados = (parsed.meta.fields ?? []).filter((h) => h !== '')
  return {
    encabezados,
    filas: parsed.data.filter((f) => Object.values(f).some((v) => String(v ?? '').trim() !== '')),
    hoja: null,
    hojasDisponibles: [],
  }
}

/**
 * Lee un Excel. Por defecto toma la primera hoja, que es donde el 95% de los
 * clientes tiene la cartera; `nombreHoja` permite elegir otra desde la UI.
 *
 * `cellDates` hace que las fechas lleguen como `Date` en vez de como serial,
 * pero el normalizador acepta ambos porque no todos los archivos las marcan
 * como fecha.
 */
export function leerXlsx(datos: ArrayBuffer | Uint8Array, nombreHoja?: string): ArchivoLeido {
  const libro = XLSX.read(datos, { type: 'array', cellDates: true })
  const hojasDisponibles = libro.SheetNames
  const hoja = nombreHoja ?? hojasDisponibles[0]
  if (!hoja || !libro.Sheets[hoja]) {
    throw new Error(`El archivo no tiene la hoja "${hoja}". Disponibles: ${hojasDisponibles.join(', ')}`)
  }

  const filas = XLSX.utils.sheet_to_json<Fila>(libro.Sheets[hoja], {
    defval: null,
    raw: true,
  })

  // sheet_to_json infiere los encabezados fila por fila; para la vista previa
  // se necesita el orden real de las columnas, que sí está en la primera fila.
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[hoja], { header: 1, raw: true })
  const encabezados = (matriz[0] ?? [])
    .map((h) => String(h ?? '').trim())
    .filter((h) => h !== '')

  return { encabezados, filas, hoja, hojasDisponibles }
}

export function leerArchivo(
  nombreArchivo: string,
  datos: ArrayBuffer | Uint8Array | string,
  nombreHoja?: string,
): ArchivoLeido {
  const formato = detectarFormato(nombreArchivo)
  if (!formato) {
    throw new Error(`Formato no soportado: "${nombreArchivo}". Se aceptan .csv, .xlsx y .xls.`)
  }
  if (formato === 'csv') {
    const texto = typeof datos === 'string' ? datos : new TextDecoder('utf-8').decode(datos)
    return leerCsv(texto)
  }
  if (typeof datos === 'string') throw new Error('Un Excel debe llegar como binario, no como texto.')
  return leerXlsx(datos, nombreHoja)
}
