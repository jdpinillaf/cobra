import { requerirSesion } from '@/auth/actual'
import { detectarFormato, leerArchivo } from '@/ingest/cargar'
import { cruzar, detectarColumnas, type ResultadoCruce } from '@/conciliacion/cruce'

/**
 * Cruza el export del software contable contra el Excel del cliente.
 *
 * **No guarda nada.** Los dos archivos entran, sale el descuadre y no queda
 * copia: en la primera reunión nadie quiere que su cartera se suba a un
 * servidor, y sin persistencia no hay nada que prometer sobre dónde vive. El
 * día que haga falta historial se agrega una tabla, no se cambia el cruce.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Los archivos de cartera que se ven en la práctica no pasan de unos megas. */
const MAXIMO_BYTES = 15 * 1024 * 1024

export interface RespuestaCruce {
  encabezados: { contable: string[]; excel: string[] }
  columnas: { clave: string | null; monto: string | null }
  filas: { contable: number; excel: number }
  cruce: ResultadoCruce | null
  error?: string
}

async function leer(archivo: File): Promise<{ encabezados: string[]; filas: Record<string, unknown>[] }> {
  if (archivo.size > MAXIMO_BYTES) {
    throw new Error(`"${archivo.name}" pesa más de 15 MB`)
  }
  if (!detectarFormato(archivo.name)) {
    throw new Error(`"${archivo.name}" no es .xlsx ni .csv`)
  }
  const leido = leerArchivo(archivo.name, await archivo.arrayBuffer())
  return { encabezados: leido.encabezados, filas: leido.filas }
}

export async function POST(request: Request): Promise<Response> {
  await requerirSesion()

  const cuerpo = await request.formData()
  const contable = cuerpo.get('contable')
  const excel = cuerpo.get('excel')

  if (!(contable instanceof File) || !(excel instanceof File)) {
    return Response.json({ error: 'Faltan los dos archivos.' }, { status: 400 })
  }

  let a: Awaited<ReturnType<typeof leer>>
  let b: Awaited<ReturnType<typeof leer>>
  try {
    ;[a, b] = await Promise.all([leer(contable), leer(excel)])
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' },
      { status: 400 },
    )
  }

  const detectadas = detectarColumnas(a.encabezados, b.encabezados)
  const clave = (cuerpo.get('clave') as string | null) || detectadas.clave
  const monto = (cuerpo.get('monto') as string | null) || detectadas.monto

  const base: RespuestaCruce = {
    encabezados: { contable: a.encabezados, excel: b.encabezados },
    columnas: { clave, monto },
    filas: { contable: a.filas.length, excel: b.filas.length },
    cruce: null,
  }

  if (!clave || !monto) {
    return Response.json({
      ...base,
      error: 'No reconocí cuál es la referencia y cuál el valor. Elíjalas abajo.',
    })
  }

  return Response.json({ ...base, cruce: cruzar(a.filas, b.filas, { clave, monto }) })
}
