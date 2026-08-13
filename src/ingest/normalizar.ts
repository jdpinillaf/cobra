import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Normalizadores para archivos de cartera reales.
 *
 * La base de un prestamista colombiano llega con celulares escritos de seis
 * formas distintas, montos con separador de miles, cédulas con puntos y fechas
 * en tres formatos. Nada de esto es excepcional: es el caso normal. Por eso
 * cada normalizador devuelve `null` en vez de lanzar — la fila mala va a
 * cuarentena y la carga continúa.
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string }

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor })
const falla = (error: string): Resultado<never> => ({ ok: false, error })

/**
 * Celular colombiano a E.164.
 *
 * WhatsApp solo funciona sobre móviles. Un fijo de Bogotá es un número válido
 * pero inútil para el canal, así que se rechaza explícitamente en vez de
 * dejarlo pasar y fallar en el envío.
 */
export function normalizarCelular(crudo: unknown): Resultado<string> {
  if (crudo === null || crudo === undefined) return falla('vacío')
  const texto = String(crudo).trim()
  if (texto === '') return falla('vacío')

  // Excel guarda los celulares como número y se come el cero o el más.
  let limpio = texto.replace(/[\s\-().]/g, '')
  if (limpio.startsWith('00')) limpio = `+${limpio.slice(2)}`
  else if (limpio.startsWith('0') && !limpio.startsWith('0+')) limpio = limpio.slice(1)

  const conPrefijo = limpio.startsWith('+') ? limpio : limpio.startsWith('57') && limpio.length >= 12 ? `+${limpio}` : limpio

  const numero = parsePhoneNumberFromString(conPrefijo, 'CO')
  if (!numero || !numero.isValid()) return falla(`teléfono inválido: "${texto}"`)
  if (numero.country !== 'CO') return falla(`número no colombiano: "${texto}"`)

  // `getType()` no sirve aquí: el bundle de metadata mínima de libphonenumber
  // lo devuelve `undefined` para Colombia. El plan de numeración nacional sí es
  // inequívoco — los móviles son 10 dígitos que empiezan por 3, y los fijos por
  // 60X desde la renumeración de 2022.
  const nacional = String(numero.nationalNumber)
  if (!/^3\d{9}$/.test(nacional)) {
    return falla(`no es un celular colombiano, no sirve para WhatsApp: "${texto}"`)
  }

  return ok(numero.number)
}

/** Cédula/NIT sin puntos, guiones ni espacios. */
export function normalizarDocumento(crudo: unknown): Resultado<string> {
  if (crudo === null || crudo === undefined) return falla('vacío')
  const limpio = String(crudo).trim().replace(/[.\s-]/g, '')
  if (limpio === '') return falla('vacío')
  if (!/^[0-9A-Za-z]+$/.test(limpio)) return falla(`documento inválido: "${crudo}"`)
  return ok(limpio.toUpperCase())
}

/**
 * Monto en pesos, redondeado a entero.
 *
 * El formato colombiano usa punto para miles y coma para decimales, pero los
 * exports en inglés lo invierten. La regla que resuelve ambos: si aparecen los
 * dos separadores, el que esté más a la derecha es el decimal.
 */
export function normalizarMonto(crudo: unknown): Resultado<number> {
  if (crudo === null || crudo === undefined || crudo === '') return falla('vacío')
  if (typeof crudo === 'number') {
    return Number.isFinite(crudo) ? ok(Math.round(crudo)) : falla('monto no numérico')
  }

  let texto = String(crudo).trim().replace(/[$\s]/g, '').replace(/COP/gi, '')
  const negativo = /^\(.*\)$/.test(texto) || texto.startsWith('-')
  texto = texto.replace(/^[-(]|\)$/g, '')
  if (texto === '') return falla('vacío')

  const ultimoPunto = texto.lastIndexOf('.')
  const ultimaComa = texto.lastIndexOf(',')

  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const decimal = ultimoPunto > ultimaComa ? '.' : ','
    const miles = decimal === '.' ? ',' : '.'
    texto = texto.split(miles).join('').replace(decimal, '.')
  } else if (ultimaComa >= 0) {
    // Una sola coma: es decimal solo si deja 1 o 2 dígitos a la derecha.
    const decimales = texto.length - ultimaComa - 1
    texto = decimales <= 2 ? texto.replace(',', '.') : texto.split(',').join('')
  } else if (ultimoPunto >= 0) {
    const decimales = texto.length - ultimoPunto - 1
    if (decimales === 3) texto = texto.split('.').join('')
  }

  const valor = Number(texto)
  if (!Number.isFinite(valor)) return falla(`monto inválido: "${crudo}"`)
  return ok(Math.round(negativo ? -valor : valor))
}

const EPOCA_EXCEL = Date.UTC(1899, 11, 30)

/**
 * Fecha a `YYYY-MM-DD`.
 *
 * Acepta ISO, `DD/MM/YYYY`, `DD-MM-YYYY` y el número de serie de Excel. En
 * Colombia el orden es día/mes, así que `03/04/2026` es 3 de abril, nunca 4 de
 * marzo — invertirlo desplazaría cadencias enteras.
 */
export function normalizarFecha(crudo: unknown): Resultado<string> {
  if (crudo === null || crudo === undefined || crudo === '') return falla('vacío')

  if (crudo instanceof Date) {
    return Number.isNaN(crudo.getTime()) ? falla('fecha inválida') : ok(crudo.toISOString().slice(0, 10))
  }

  if (typeof crudo === 'number') {
    if (crudo < 1 || crudo > 100_000) return falla(`serial de Excel fuera de rango: ${crudo}`)
    return ok(new Date(EPOCA_EXCEL + crudo * 86_400_000).toISOString().slice(0, 10))
  }

  const texto = String(crudo).trim()

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return validarYMD(Number(iso[1]), Number(iso[2]), Number(iso[3]), texto)

  const dmy = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (dmy) {
    const anio = Number(dmy[3])
    return validarYMD(anio < 100 ? 2000 + anio : anio, Number(dmy[2]), Number(dmy[1]), texto)
  }

  return falla(`fecha inválida: "${texto}"`)
}

function validarYMD(anio: number, mes: number, dia: number, original: string): Resultado<string> {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return falla(`fecha inválida: "${original}"`)
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return falla(`fecha inexistente: "${original}"`)
  }
  return ok(d.toISOString().slice(0, 10))
}

/** Días de mora entre el vencimiento y la fecha de corte. Negativo = aún no vence. */
export function calcularDiasMora(fechaVencimiento: string, hoy: string): number {
  const v = new Date(`${fechaVencimiento}T00:00:00Z`).getTime()
  const h = new Date(`${hoy}T00:00:00Z`).getTime()
  return Math.round((h - v) / 86_400_000)
}
