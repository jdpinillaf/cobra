/**
 * El cruce: dos tablas del mismo dinero, y qué no cuadra.
 *
 * Es el producto. El cliente exporta su software contable, tiene su Excel
 * paralelo —siempre hay un Excel paralelo— y necesita saber **cuántos pesos**
 * están en uno y no en el otro. No cuántas filas: cuántos pesos. Un conteo de
 * filas no se lleva a una junta.
 *
 * Tres decisiones que sostienen el resultado:
 *
 * 1. **Centavos enteros.** `normalizarMontoCentavos` existe justamente porque la
 *    conciliación no tolera coma flotante: `0.1 + 0.2` deja un descuadre de un
 *    centavo que después nadie encuentra.
 * 2. **Tolerancia cero por defecto.** «Que no se pierda ningún valor» significa
 *    cero, no «casi». Quien quiera aflojarla tiene que escribirlo.
 * 3. **Las claves se normalizan.** `CR-00034`, `cr00034` y ` CR 00034 ` son la
 *    misma referencia para cualquier humano, y los dos archivos nunca vienen
 *    escritos igual. Sin esto, el primer cruce contra archivos reales devuelve
 *    que **nada** cuadra, que es la forma más rápida de perder la reunión.
 */
import { normalizarMontoCentavos } from '@/ingest/normalizar'

export type Descuadre =
  | 'cuadra'
  | 'falta_en_contable'
  | 'falta_en_excel'
  | 'monto_distinto'
  | 'duplicado'

export type Fila = Record<string, unknown>

export interface FilaCruzada {
  clave: string
  /** La clave como venía escrita, para que el cliente reconozca su propia fila. */
  claveOriginal: string
  descuadre: Descuadre
  contableCentavos: number | null
  excelCentavos: number | null
  /** Contable − Excel. Positivo: sobra en el contable. */
  diferenciaCentavos: number
  vecesEnContable: number
  vecesEnExcel: number
}

export interface FilaIlegible {
  origen: 'contable' | 'excel'
  numeroFila: number
  motivo: string
  fila: Fila
}

export interface ResultadoCruce {
  filas: FilaCruzada[]
  resumen: Record<Descuadre, number>
  /**
   * La cifra del titular: la plata que está en un lado y no en el otro, más lo
   * que difiere en los montos que no coinciden. Es lo que se pierde si nadie
   * mira.
   */
  valorEnRiesgoCentavos: number
  totalContableCentavos: number
  totalExcelCentavos: number
  ilegibles: FilaIlegible[]
}

export interface OpcionesCruce {
  clave: string
  monto: string
  /** En centavos. Cero significa cero. */
  toleranciaCentavos?: number
}

/**
 * `CR-00034` → `CR00034`.
 *
 * Se quitan espacios, guiones y puntos, y se sube a mayúsculas. Deliberadamente
 * **no** se quitan los ceros a la izquierda: `00034` y `34` pueden ser dos
 * créditos distintos, y fusionarlos inventaría un cuadre que no existe.
 */
export function normalizarClave(crudo: unknown): string {
  return String(crudo ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s.\-_/]/g, '')
}

interface Lado {
  porClave: Map<string, { centavos: number; veces: number; original: string }>
  total: number
}

function indexar(
  filas: Fila[],
  origen: 'contable' | 'excel',
  o: OpcionesCruce,
  ilegibles: FilaIlegible[],
): Lado {
  const porClave = new Map<string, { centavos: number; veces: number; original: string }>()
  let total = 0

  filas.forEach((fila, i) => {
    const original = String(fila[o.clave] ?? '').trim()
    const clave = normalizarClave(fila[o.clave])
    // +2: la fila 1 son los encabezados, y el humano cuenta desde 1.
    const numeroFila = i + 2

    if (clave === '') {
      ilegibles.push({ origen, numeroFila, motivo: `sin "${o.clave}"`, fila })
      return
    }

    const monto = normalizarMontoCentavos(fila[o.monto])
    if (!monto.ok) {
      ilegibles.push({ origen, numeroFila, motivo: `"${o.monto}": ${monto.error}`, fila })
      return
    }

    total += monto.valor
    const previo = porClave.get(clave)
    if (previo) {
      // Un duplicado **suma**: dos filas con la misma referencia suelen ser dos
      // abonos al mismo crédito. Quedarse con la última escondería el otro.
      porClave.set(clave, {
        centavos: previo.centavos + monto.valor,
        veces: previo.veces + 1,
        original: previo.original,
      })
    } else {
      porClave.set(clave, { centavos: monto.valor, veces: 1, original })
    }
  })

  return { porClave, total }
}

export function cruzar(contable: Fila[], excel: Fila[], o: OpcionesCruce): ResultadoCruce {
  const tolerancia = o.toleranciaCentavos ?? 0
  const ilegibles: FilaIlegible[] = []

  const a = indexar(contable, 'contable', o, ilegibles)
  const b = indexar(excel, 'excel', o, ilegibles)

  const filas: FilaCruzada[] = []
  const resumen: Record<Descuadre, number> = {
    cuadra: 0,
    falta_en_contable: 0,
    falta_en_excel: 0,
    monto_distinto: 0,
    duplicado: 0,
  }
  let valorEnRiesgoCentavos = 0

  for (const clave of new Set([...a.porClave.keys(), ...b.porClave.keys()])) {
    const enA = a.porClave.get(clave)
    const enB = b.porClave.get(clave)
    const diferencia = (enA?.centavos ?? 0) - (enB?.centavos ?? 0)

    let descuadre: Descuadre
    if (!enB) descuadre = 'falta_en_excel'
    else if (!enA) descuadre = 'falta_en_contable'
    else if (Math.abs(diferencia) > tolerancia) descuadre = 'monto_distinto'
    else if (enA.veces > 1 || enB.veces > 1) descuadre = 'duplicado'
    else descuadre = 'cuadra'

    // Un duplicado que cuadra en total no pone plata en riesgo, pero sí hay que
    // mirarlo: dos filas iguales pueden ser un pago cargado dos veces.
    if (descuadre !== 'cuadra' && descuadre !== 'duplicado') {
      valorEnRiesgoCentavos += Math.abs(diferencia)
    }

    resumen[descuadre] += 1
    filas.push({
      clave,
      claveOriginal: enA?.original ?? enB?.original ?? clave,
      descuadre,
      contableCentavos: enA?.centavos ?? null,
      excelCentavos: enB?.centavos ?? null,
      diferenciaCentavos: diferencia,
      vecesEnContable: enA?.veces ?? 0,
      vecesEnExcel: enB?.veces ?? 0,
    })
  }

  // Lo que no cuadra primero, y dentro de eso lo más caro: es el orden en que
  // alguien va a trabajar la lista.
  const PESO: Record<Descuadre, number> = {
    falta_en_contable: 0,
    falta_en_excel: 1,
    monto_distinto: 2,
    duplicado: 3,
    cuadra: 4,
  }
  filas.sort(
    (x, y) =>
      PESO[x.descuadre] - PESO[y.descuadre] ||
      Math.abs(y.diferenciaCentavos) - Math.abs(x.diferenciaCentavos),
  )

  return {
    filas,
    resumen,
    valorEnRiesgoCentavos,
    totalContableCentavos: a.total,
    totalExcelCentavos: b.total,
    ilegibles,
  }
}

/**
 * Adivina qué columna es la referencia y cuál el monto.
 *
 * Mismo criterio que `src/ingest/mapeador.ts`: un diccionario de sinónimos en
 * español colombiano. Adivinar bien la primera vez es la diferencia entre una
 * pantalla que el cliente entiende sola y una que le pide configurar algo antes
 * de ver nada. Cuando no hay certeza se devuelve `null` y decide la persona.
 */
const SINONIMOS_CLAVE = [
  'referencia', 'ref', 'numero de credito', 'numero credito', 'credito', 'obligacion',
  'factura', 'numero de factura', 'documento', 'nit', 'cedula', 'identificacion',
  'comprobante', 'consecutivo', 'codigo',
]

const SINONIMOS_MONTO = [
  'valor', 'monto', 'total', 'saldo', 'importe', 'abono', 'pago', 'debe', 'haber',
  'valor total', 'saldo total', 'valor pagado', 'vr', 'cuantia',
]

const plano = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function elegir(encabezados: string[], sinonimos: string[]): string | null {
  const normalizados = encabezados.map((e) => ({ crudo: e, plano: plano(e) }))
  // Coincidencia exacta primero: `valor` gana sobre `valor unitario`.
  for (const s of sinonimos) {
    const exacto = normalizados.find((e) => e.plano === s)
    if (exacto) return exacto.crudo
  }
  for (const s of sinonimos) {
    const parcial = normalizados.find((e) => e.plano.includes(s))
    if (parcial) return parcial.crudo
  }
  return null
}

export function detectarColumnas(
  encabezadosContable: string[],
  encabezadosExcel: string[],
): { clave: string | null; monto: string | null } {
  // La columna tiene que existir en **los dos** archivos: cruzar por una que
  // solo está de un lado devolvería que nada coincide.
  const comunes = encabezadosContable.filter((e) =>
    encabezadosExcel.some((o) => plano(o) === plano(e)),
  )
  return {
    clave: elegir(comunes, SINONIMOS_CLAVE),
    monto: elegir(comunes, SINONIMOS_MONTO),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cruce de más de dos fuentes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuando hay tres orígenes —el portal contable, el del banco y el Excel de la
 * operación— la pregunta deja de ser «cuál de los dos miente» y pasa a ser
 * **quién se desvía del resto**. Un descuadre que aparece en dos fuentes contra
 * una es un error de captura; uno que aparece en una contra dos, un dato que se
 * perdió en el camino.
 */
export type EstadoFila = 'cuadra' | 'falta_en_alguna' | 'monto_distinto'

export interface FilaMultiple {
  clave: string
  claveOriginal: string
  estado: EstadoFila
  /** Monto por fuente, en centavos. `null` = la fuente no tiene esa referencia. */
  porFuente: Record<string, number | null>
  /** En qué fuentes falta. Vacío si está en todas. */
  faltaEn: string[]
  /** Diferencia entre el mayor y el menor de los montos presentes. */
  dispersionCentavos: number
  /**
   * Cuál se sale del promedio de las demás. `null` cuando no hay mayoría
   * —dos fuentes que difieren no tienen quién desempate—.
   */
  sospechosa: string | null
}

export interface FuenteCruzada {
  clave: string
  nombre: string
  filas: Fila[]
}

export interface ResultadoMultiple {
  fuentes: Array<{ clave: string; nombre: string; filas: number; totalCentavos: number }>
  filas: FilaMultiple[]
  resumen: Record<EstadoFila, number>
  valorEnRiesgoCentavos: number
  ilegibles: FilaIlegible[]
}

export function cruzarVarias(
  fuentes: FuenteCruzada[],
  o: OpcionesCruce,
): ResultadoMultiple {
  const tolerancia = o.toleranciaCentavos ?? 0
  const ilegibles: FilaIlegible[] = []

  const indices = fuentes.map((f) => {
    const propias: FilaIlegible[] = []
    const lado = indexar(f.filas, 'contable', o, propias)
    // El origen del `FilaIlegible` es la clave de la fuente, no un fijo: con
    // tres orígenes, «fila 72» sin decir de cuál no sirve para nada.
    for (const i of propias) ilegibles.push({ ...i, origen: f.clave as 'contable' | 'excel' })
    return { ...f, lado }
  })

  const claves = new Set<string>()
  for (const i of indices) for (const k of i.lado.porClave.keys()) claves.add(k)

  const filas: FilaMultiple[] = []
  const resumen: Record<EstadoFila, number> = {
    cuadra: 0,
    falta_en_alguna: 0,
    monto_distinto: 0,
  }
  let valorEnRiesgoCentavos = 0

  for (const clave of claves) {
    const porFuente: Record<string, number | null> = {}
    const faltaEn: string[] = []
    const presentes: number[] = []
    let claveOriginal = clave

    for (const i of indices) {
      const encontrada = i.lado.porClave.get(clave)
      porFuente[i.clave] = encontrada?.centavos ?? null
      if (encontrada) {
        presentes.push(encontrada.centavos)
        claveOriginal = encontrada.original || claveOriginal
      } else {
        faltaEn.push(i.clave)
      }
    }

    const mayor = Math.max(...presentes)
    const menor = Math.min(...presentes)
    const dispersion = presentes.length > 0 ? mayor - menor : 0

    let estado: EstadoFila
    if (faltaEn.length > 0) estado = 'falta_en_alguna'
    else if (dispersion > tolerancia) estado = 'monto_distinto'
    else estado = 'cuadra'

    if (estado !== 'cuadra') {
      // Lo que está en juego: lo que falta se cuenta por el monto que sí se
      // conoce; lo que difiere, por la brecha.
      valorEnRiesgoCentavos += faltaEn.length > 0 ? mayor : dispersion
    }

    resumen[estado] += 1
    filas.push({
      clave,
      claveOriginal,
      estado,
      porFuente,
      faltaEn,
      dispersionCentavos: dispersion,
      sospechosa: quienSeDesvia(porFuente, tolerancia),
    })
  }

  filas.sort(
    (a, b) =>
      (a.estado === 'cuadra' ? 1 : 0) - (b.estado === 'cuadra' ? 1 : 0) ||
      b.dispersionCentavos - a.dispersionCentavos,
  )

  return {
    fuentes: indices.map((i) => ({
      clave: i.clave,
      nombre: i.nombre,
      filas: i.filas.length,
      totalCentavos: i.lado.total,
    })),
    filas,
    resumen,
    valorEnRiesgoCentavos,
    ilegibles,
  }
}

/**
 * Con tres o más fuentes, la que difiere de una mayoría que coincide.
 *
 * Necesita al menos tres presentes y un acuerdo estricto entre las otras: con
 * dos que no coinciden no hay a quién creerle, y decir que una es la sospechosa
 * sería inventar un culpable.
 */
function quienSeDesvia(
  porFuente: Record<string, number | null>,
  tolerancia: number,
): string | null {
  const presentes = Object.entries(porFuente).filter(
    (e): e is [string, number] => e[1] !== null,
  )
  if (presentes.length < 3) return null

  for (const [clave, valor] of presentes) {
    const otras = presentes.filter((e) => e[0] !== clave).map((e) => e[1])
    const coincidenEntreEllas = Math.max(...otras) - Math.min(...otras) <= tolerancia
    const seSale = otras.some((o) => Math.abs(o - valor) > tolerancia)
    if (coincidenEntreEllas && seSale) return clave
  }
  return null
}
