import { ejecutarPaso, pasosPendientes } from '@/cadence/motor'
import { enBogota } from '@/compliance/reloj-bogota'
import { conTenant } from '@/repo/con-tenant'
import { obtenerDb } from '@/repo/conexion'

/**
 * El latido del motor.
 *
 * Vercel Cron lo llama cada 15 minutos. Por cada cliente con cobranza activa
 * busca los pasos de cadencia que ya vencieron y los ejecuta. Las tres ramas
 * —enviado, reprogramado, detenido— escriben un `Contacto`, incluida la que no
 * envía: ante un reclamo, lo que prueba que la empresa cumplió la Ley 2300 no es
 * el mensaje que salió, es el que no salió y por qué.
 *
 * **La fecha se calcula en hora de Bogotá.** El servidor corre en UTC, y a las
 * 20:00 de Colombia ya es el día siguiente allá: sin esto, un paso programado
 * para mañana saldría hoy a la noche.
 *
 * Cada tenant corre dentro de su propio `conTenant`, así RLS también aplica y no
 * solo el `WHERE` de cada consulta. Y si uno falla, los demás siguen: el
 * problema de un cliente no puede dejar sin cobrar a los otros.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function autorizado(request: Request): boolean {
  const esperado = process.env.CRON_SECRETO
  // Sin secreto configurado no se atiende. Un cron abierto a internet deja que
  // cualquiera dispare la cadencia de todos los clientes cuando quiera.
  if (!esperado) return false

  // Vercel manda `Authorization: Bearer <CRON_SECRET>` en sus crons.
  const cabecera = request.headers.get('authorization') ?? ''
  return cabecera === `Bearer ${esperado}`
}

export async function GET(request: Request): Promise<Response> {
  if (!autorizado(request)) {
    return new Response('No autorizado', { status: 401 })
  }

  const db = await obtenerDb()
  const hoy = enBogota(new Date()).fecha
  const ahora = new Date()

  const tenants = await db.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tenants
      WHERE estado = 'activo' AND 'cobranza' = ANY(capacidades)`,
  )

  const resumen: Array<Record<string, unknown>> = []

  for (const tenant of tenants) {
    try {
      const conteo = await conTenant(db, tenant.id, async (tx) => {
        const pendientes = await pasosPendientes(tx, tenant.id, hoy)
        const cuenta = { enviados: 0, reprogramados: 0, detenidos: 0, omitidos: 0 }

        for (const p of pendientes) {
          const r = await ejecutarPaso(tx, tenant.id, {
            obligacionId: p.obligacionId,
            indice: p.indice,
            ahora,
          })
          if (r.tipo === 'enviado') cuenta.enviados += 1
          else if (r.tipo === 'reprogramado') cuenta.reprogramados += 1
          else if (r.tipo === 'detenido') cuenta.detenidos += 1
          else cuenta.omitidos += 1
        }

        return { pendientes: pendientes.length, ...cuenta }
      })

      resumen.push({ tenant: tenant.nombre, ...conteo })
    } catch (e) {
      // Un cliente que falla no puede dejar sin cobrar a los demás.
      console.error(`[cron] falló el tenant ${tenant.nombre}`, e)
      resumen.push({ tenant: tenant.nombre, error: String(e) })
    }
  }

  return Response.json({ fecha: hoy, tenants: resumen })
}
