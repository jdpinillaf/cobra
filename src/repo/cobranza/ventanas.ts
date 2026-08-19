import type { VentanaServicio } from '@/domain/types'
import { abrirVentana } from '@/channels/ventana-servicio'
import type { Db } from '../db'

/**
 * La ventana de servicio de 24 h.
 *
 * Vive en su propia tabla y no en `conversaciones` a propósito: un hilo de
 * bandeja dura mientras el caso siga abierto, y la ventana dura 24 horas desde
 * el último mensaje del deudor. Mezclarlas hacía que un hilo de tres días se
 * reutilizara como si fuera la misma ventana, y de las dos definiciones ganaba
 * la que subfactura.
 */

export async function ventanaDe(
  db: Db,
  tenantId: string,
  deudorId: string,
): Promise<VentanaServicio | null> {
  const filas = await db.query<{ abierta_en: Date; expira_en: Date }>(
    `SELECT abierta_en, expira_en FROM ventanas_servicio
      WHERE tenant_id = $1 AND deudor_id = $2`,
    [tenantId, deudorId],
  )
  if (filas.length === 0) return null

  return {
    clienteId: tenantId,
    deudorId,
    abiertaEn: new Date(filas[0].abierta_en).toISOString(),
    expiraEn: new Date(filas[0].expira_en).toISOString(),
  }
}

/**
 * Cada mensaje entrante reinicia las 24 h. Se guarda la más lejana con
 * `GREATEST` para que un webhook reentregado fuera de orden no la achique.
 */
export async function renovarVentana(
  db: Db,
  tenantId: string,
  deudorId: string,
  entranteEn: string,
): Promise<VentanaServicio> {
  const ventana = abrirVentana({ clienteId: tenantId, deudorId, entranteEn })

  await db.query(
    `INSERT INTO ventanas_servicio (tenant_id, deudor_id, abierta_en, expira_en)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, deudor_id) DO UPDATE
       SET abierta_en = GREATEST(ventanas_servicio.abierta_en, EXCLUDED.abierta_en),
           expira_en  = GREATEST(ventanas_servicio.expira_en,  EXCLUDED.expira_en)`,
    [tenantId, deudorId, ventana.abiertaEn, ventana.expiraEn],
  )

  return ventana
}

export interface PlantillaDisponible {
  id: string
  nombre: string
  nombreMeta: string | null
  categoria: 'utility' | 'marketing' | 'authentication'
  cuerpo: string
  variables: string[]
  aprobada: boolean
}

/** Solo las aprobadas sirven para enviar; las demás Meta las rechaza. */
export async function plantillasAprobadas(
  db: Db,
  tenantId: string,
): Promise<PlantillaDisponible[]> {
  const filas = await db.query<{
    id: string
    nombre: string
    nombre_meta: string | null
    categoria: 'utility' | 'marketing' | 'authentication'
    cuerpo: string
    variables: string[]
    aprobada_en_meta: boolean
  }>(
    `SELECT id, nombre, nombre_meta, categoria, cuerpo, variables, aprobada_en_meta
       FROM plantillas
      WHERE tenant_id = $1 AND canal = 'whatsapp' AND aprobada_en_meta
      ORDER BY nombre`,
    [tenantId],
  )

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    nombreMeta: f.nombre_meta,
    categoria: f.categoria,
    cuerpo: f.cuerpo,
    variables: f.variables,
    aprobada: f.aprobada_en_meta,
  }))
}
