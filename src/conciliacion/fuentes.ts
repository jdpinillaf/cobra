/**
 * De dónde salen los datos a conciliar.
 *
 * Hoy el insumo es un archivo que alguien exporta. Mañana va a ser la API de un
 * portal contable, y en algún caso un portal que no tiene API y hay que
 * recorrer con un navegador. **Las tres cosas son la misma pregunta** —dame
 * filas con una referencia y un monto— y por eso viven detrás de un puerto.
 *
 * Escribirlo así ahora no es anticiparse: es lo que evita que el motor de cruce
 * termine sabiendo de `fetch`, de cookies y de sesiones que expiran. El día que
 * aparezca el portal real, se agrega una implementación y el cruce no se entera.
 */
import { detectarFormato, leerArchivo } from '@/ingest/cargar'
import type { Fila } from './cruce'

export type TipoFuente = 'archivo' | 'api' | 'navegador' | 'sheets'

export interface Extraccion {
  encabezados: string[]
  filas: Fila[]
  /** Cuándo se leyó. Conciliar contra un saldo de ayer es conciliar mal. */
  obtenidoEn: string
  /** Lo que hay que poder mostrarle al cliente cuando pregunte de dónde salió. */
  procedencia: string
}

export interface FuenteDeDatos {
  readonly clave: string
  readonly nombre: string
  readonly tipo: TipoFuente
  obtener(): Promise<Extraccion>
}

/** Un archivo que alguien exportó y subió. Es lo que existe hoy. */
export class FuenteArchivo implements FuenteDeDatos {
  readonly tipo = 'archivo' as const

  constructor(
    readonly clave: string,
    readonly nombre: string,
    private readonly archivo: { nombre: string; datos: ArrayBuffer },
  ) {}

  async obtener(): Promise<Extraccion> {
    if (!detectarFormato(this.archivo.nombre)) {
      throw new Error(`"${this.archivo.nombre}" no es .xlsx ni .csv`)
    }
    const leido = leerArchivo(this.archivo.nombre, this.archivo.datos)
    return {
      encabezados: leido.encabezados,
      filas: leido.filas,
      obtenidoEn: new Date().toISOString(),
      procedencia: `archivo ${this.archivo.nombre}`,
    }
  }
}

export interface ConfigApi {
  url: string
  cabeceras?: Record<string, string>
  /**
   * Dónde vive el arreglo de filas dentro de la respuesta.
   *
   * Ningún portal devuelve el arreglo pelado: unos lo meten en `data`, otros en
   * `results`, otros en `Movimientos`. Un camino configurable evita un
   * adaptador por proveedor para lo único que cambia.
   */
  camino?: string
  /** Renombra campos del portal a los nombres con los que se cruza. */
  mapeo?: Record<string, string>
}

/**
 * Un portal con API. Es a donde va esto.
 *
 * El `mapeo` existe porque cada portal le pone otro nombre a lo mismo:
 * `numero_documento`, `docNumber`, `Consecutivo`. Normalizarlo acá deja al
 * cruce hablando un solo vocabulario.
 */
export class FuenteApi implements FuenteDeDatos {
  readonly tipo = 'api' as const

  constructor(
    readonly clave: string,
    readonly nombre: string,
    private readonly config: ConfigApi,
    private readonly traer: typeof fetch = fetch,
  ) {}

  async obtener(): Promise<Extraccion> {
    const r = await this.traer(this.config.url, { headers: this.config.cabeceras })
    if (!r.ok) {
      throw new Error(`${this.nombre} respondió ${r.status}`)
    }

    const cuerpo: unknown = await r.json()
    const crudas = extraerArreglo(cuerpo, this.config.camino)
    const filas = crudas.map((f) => aplicarMapeo(f, this.config.mapeo))

    return {
      encabezados: filas.length > 0 ? Object.keys(filas[0]) : [],
      filas,
      obtenidoEn: new Date().toISOString(),
      procedencia: `${this.nombre} · ${new URL(this.config.url).host}`,
    }
  }
}

/**
 * Un portal sin API, recorrido con un navegador.
 *
 * Todavía no se implementa, y el error lo dice en voz alta en vez de devolver
 * cero filas: una fuente que calla y devuelve vacío hace que el cruce reporte
 * que **todo** falta, y eso se lee como un descuadre gigante en vez de como una
 * integración que no existe. El día que haga falta, lo único que cambia es esta
 * clase.
 */
export class FuenteNavegador implements FuenteDeDatos {
  readonly tipo = 'navegador' as const

  constructor(
    readonly clave: string,
    readonly nombre: string,
    private readonly config: { portal: string; usuario?: string },
  ) {}

  async obtener(): Promise<Extraccion> {
    throw new Error(
      `${this.nombre}: ${this.config.portal} no tiene API y todavía no está el recorrido con navegador. ` +
        'Mientras tanto, súbalo como archivo exportado.',
    )
  }
}

function extraerArreglo(cuerpo: unknown, camino?: string): Fila[] {
  let actual: unknown = cuerpo
  for (const paso of (camino ?? '').split('.').filter(Boolean)) {
    actual = (actual as Record<string, unknown>)?.[paso]
  }
  if (!Array.isArray(actual)) {
    throw new Error(
      camino
        ? `la respuesta no trae un arreglo en "${camino}"`
        : 'la respuesta no es un arreglo; indique en qué campo vienen las filas',
    )
  }
  return actual as Fila[]
}

function aplicarMapeo(fila: Fila, mapeo?: Record<string, string>): Fila {
  if (!mapeo) return fila
  const salida: Fila = { ...fila }
  for (const [origen, destino] of Object.entries(mapeo)) {
    if (origen in fila) {
      salida[destino] = fila[origen]
      delete salida[origen]
    }
  }
  return salida
}
