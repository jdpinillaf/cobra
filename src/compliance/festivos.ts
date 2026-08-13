/**
 * Festivos de Colombia.
 *
 * La Ley 2300 prohíbe el contacto de cobranza en domingos y festivos, así que
 * este calendario es parte del guard de compliance, no una utilidad decorativa:
 * un festivo mal calculado es un envío ilegal.
 *
 * Colombia tiene 18 festivos al año, en tres familias:
 *  - 6 de fecha fija que no se mueven
 *  - 7 de fecha fija que se trasladan al lunes siguiente (Ley 51 de 1983,
 *    "Ley Emiliani")
 *  - 5 derivados de la Pascua, de los cuales 3 también se trasladan al lunes
 */

/** Festivos de fecha fija que nunca se trasladan. `[mes (1-12), día]`. */
const FIJOS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], // Año Nuevo
  [5, 1], // Día del Trabajo
  [7, 20], // Independencia
  [8, 7], // Batalla de Boyacá
  [12, 8], // Inmaculada Concepción
  [12, 25], // Navidad
]

/** Festivos de fecha fija que se trasladan al lunes siguiente. */
const TRASLADABLES: ReadonlyArray<readonly [number, number]> = [
  [1, 6], // Reyes Magos
  [3, 19], // San José
  [6, 29], // San Pedro y San Pablo
  [8, 15], // Asunción de la Virgen
  [10, 12], // Día de la Raza
  [11, 1], // Todos los Santos
  [11, 11], // Independencia de Cartagena
]

/**
 * Desplazamiento en días respecto al Domingo de Pascua.
 *
 * Jueves y Viernes Santo caen siempre en su día y no se trasladan. Los otros
 * tres ya vienen con el traslado de Emiliani aplicado: Ascensión cae un jueves
 * (+39) y se corre al lunes (+43); Corpus Christi cae un jueves (+60) y pasa a
 * (+64); Sagrado Corazón cae un viernes (+68) y pasa a (+71).
 */
const OFFSETS_PASCUA: ReadonlyArray<number> = [
  -3, // Jueves Santo
  -2, // Viernes Santo
  43, // Ascensión del Señor
  64, // Corpus Christi
  71, // Sagrado Corazón de Jesús
]

/**
 * Domingo de Pascua por el algoritmo gregoriano anónimo (Meeus/Jones/Butcher).
 * Devuelve un Date en UTC a medianoche.
 */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19
  const b = Math.floor(anio / 100)
  const c = anio % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(anio, mes - 1, dia))
}

/** Traslada al lunes siguiente si la fecha no cae ya en lunes. */
function trasladarALunes(fecha: Date): Date {
  const dias = (8 - fecha.getUTCDay()) % 7
  return new Date(fecha.getTime() + dias * 86_400_000)
}

function aClave(fecha: Date): string {
  const y = fecha.getUTCFullYear()
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  const d = String(fecha.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const cachePorAnio = new Map<number, Set<string>>()

/**
 * Todos los festivos de un año como claves `YYYY-MM-DD`.
 *
 * Ningún festivo colombiano cruza el año al trasladarse: el trasladable más
 * tardío es el 11 de noviembre, que en el peor caso llega al 17. Por eso basta
 * con calcular el año pedido.
 */
export function festivosColombia(anio: number): Set<string> {
  const cacheado = cachePorAnio.get(anio)
  if (cacheado) return cacheado

  const claves = new Set<string>()

  for (const [mes, dia] of FIJOS) {
    claves.add(aClave(new Date(Date.UTC(anio, mes - 1, dia))))
  }
  for (const [mes, dia] of TRASLADABLES) {
    claves.add(aClave(trasladarALunes(new Date(Date.UTC(anio, mes - 1, dia)))))
  }
  const pascua = domingoDePascua(anio)
  for (const offset of OFFSETS_PASCUA) {
    claves.add(aClave(new Date(pascua.getTime() + offset * 86_400_000)))
  }

  cachePorAnio.set(anio, claves)
  return claves
}

/** `fecha` es una clave `YYYY-MM-DD` en hora local de Colombia. */
export function esFestivo(fecha: string): boolean {
  const anio = Number(fecha.slice(0, 4))
  if (!Number.isFinite(anio)) return false
  return festivosColombia(anio).has(fecha)
}
