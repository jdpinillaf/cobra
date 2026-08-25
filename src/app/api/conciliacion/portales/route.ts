import { requerirSesion } from '@/auth/actual'
import { cruzarVarias, detectarColumnas, type ResultadoMultiple } from '@/conciliacion/cruce'
import { FuenteArchivo, FuentePortalLocal, type FuenteDeDatos } from '@/conciliacion/fuentes'
import { comoPortalBanco, comoPortalContable, generarCarteraDemo } from '@/demo/portales'
import { verificar, type Veredicto } from '@/conciliacion/verificador'

/**
 * Concilia varios orígenes del mismo dinero.
 *
 * Los portales entran por `FuenteApi` y el Excel por `FuenteArchivo`, que es la
 * razón de que exista el puerto: el cruce recibe filas y no sabe si vinieron de
 * un `fetch`, de un `.xlsx` o —el día que haga falta— de un navegador
 * recorriendo un portal sin API.
 *
 * Como el de dos archivos, **no guarda nada**.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export interface RespuestaPortales {
  cruce: ResultadoMultiple | null
  veredicto: Veredicto | null
  columnas: { clave: string | null; monto: string | null }
  fuentes: Array<{ clave: string; nombre: string; tipo: string; procedencia: string; filas: number }>
  fallas: Array<{ fuente: string; motivo: string }>
  error?: string
}

export async function POST(request: Request): Promise<Response> {
  await requerirSesion()

  const cuerpo = await request.formData()

  /**
   * Los dos portales de demostración.
   *
   * Cada uno devuelve su respuesta con **su** forma —uno cuelga el arreglo de
   * `data` con campos en inglés, el otro de `resultado.movimientos` con los
   * montos como texto—, que es lo que hacen los portales de verdad. El
   * adaptador que los normaliza es el mismo que va a usar un Siigo o un
   * Bancolombia; lo único que no ocurre acá es el viaje por la red, porque
   * en Vercel una función no puede consultarse a sí misma por HTTP.
   *
   * Las rutas `/api/conciliacion/portal/*` existen igual y responden lo mismo:
   * sirven para mostrarle al cliente qué se consume.
   */
  const cartera = generarCarteraDemo()

  const fuentes: FuenteDeDatos[] = [
    new FuentePortalLocal('contable', 'Portal contable', {
      responder: () => comoPortalContable(cartera.contable),
      camino: 'data',
      mapeo: { docNumber: 'referencia', total: 'valor', customerName: 'cliente', issueDate: 'fecha' },
    }),
    new FuentePortalLocal('banco', 'Portal del banco', {
      responder: () => comoPortalBanco(cartera.banco),
      camino: 'resultado.movimientos',
      mapeo: { Referencia: 'referencia', Valor: 'valor', FechaMovimiento: 'fecha' },
    }),
  ]

  const excel = cuerpo.get('excel')
  if (excel instanceof File) {
    fuentes.push(
      new FuenteArchivo('excel', 'Excel de la operación', {
        nombre: excel.name,
        datos: await excel.arrayBuffer(),
      }),
    )
  }

  // Una fuente caída no puede tumbar la conciliación de las otras: se reporta
  // y se sigue. Lo contrario deja al cliente sin nada porque un portal estaba
  // en mantenimiento.
  const extraidas: Array<{ clave: string; nombre: string; tipo: string; procedencia: string; filas: Record<string, unknown>[] }> = []
  const fallas: RespuestaPortales['fallas'] = []

  await Promise.all(
    fuentes.map(async (f) => {
      try {
        const e = await f.obtener()
        extraidas.push({ clave: f.clave, nombre: f.nombre, tipo: f.tipo, procedencia: e.procedencia, filas: e.filas })
      } catch (error) {
        // Con el origen adentro: un 404 sin decir contra qué URL fue es una
        // hora de adivinar cuál de los tres candidatos se eligió.
        fallas.push({
          fuente: f.nombre,
          motivo: error instanceof Error ? error.message : String(error),
        })
      }
    }),
  )

  const resumenFuentes = extraidas.map((e) => ({
    clave: e.clave,
    nombre: e.nombre,
    tipo: e.tipo,
    procedencia: e.procedencia,
    filas: e.filas.length,
  }))

  if (extraidas.length < 2) {
    return Response.json({
      cruce: null,
      veredicto: null,
      columnas: { clave: null, monto: null },
      fuentes: resumenFuentes,
      fallas,
      error: 'Hacen falta al menos dos fuentes para conciliar.',
    } satisfies RespuestaPortales)
  }

  const encabezados = extraidas.map((e) => (e.filas[0] ? Object.keys(e.filas[0]) : []))
  const detectadas = detectarColumnas(encabezados[0], encabezados[1])
  const clave = (cuerpo.get('clave') as string | null) || detectadas.clave
  const monto = (cuerpo.get('monto') as string | null) || detectadas.monto

  if (!clave || !monto) {
    return Response.json({
      cruce: null,
      veredicto: null,
      columnas: { clave, monto },
      fuentes: resumenFuentes,
      fallas,
      error: 'Las fuentes no comparten una columna de referencia y una de valor.',
    } satisfies RespuestaPortales)
  }

  const cruce = cruzarVarias(extraidas, { clave, monto })

  return Response.json({
    cruce,
    veredicto: await verificar(cruce),
    columnas: { clave, monto },
    fuentes: resumenFuentes,
    fallas,
  } satisfies RespuestaPortales)
}
