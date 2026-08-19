import type { Canal, ResultadoEnvio } from '@/domain/types'
import type { Db } from '../db'

/**
 * Historial de contactos.
 *
 * `contactos` no es un log: es el entregable de cumplimiento. La cotización
 * vende "historial completo de cada intento, con hora, canal, mensaje enviado,
 * resultado y motivo, **incluidos los intentos bloqueados por política**", y
 * ante un reclamo ante la SIC esa tabla es la evidencia de que el sistema
 * respetó la Ley 2300 en vez de limitarse a no dejar rastro.
 *
 * De ahí dos reglas que parecen detalles y no lo son: se escribe una fila
 * también cuando el guard bloquea, y la lectura devuelve todo mezclado en orden
 * cronológico. Separar los bloqueados en otra consulta invita a construir la
 * consola con dos pestañas, y eso rompe justo lo que se vendió.
 */

export interface ContactoNuevo {
  obligacionId: string
  deudorId: string
  conversacionId?: string | null
  canal: Canal
  direccion: 'saliente' | 'entrante'
  /** ISO 8601 con offset. Siempre se evalúa contra hora de Bogotá. */
  timestamp: string
  plantillaId?: string | null
  cuerpo?: string
  resultado: ResultadoEnvio
  motivoBloqueo?: string | null
  /** COP real, decimal. Una plantilla utility cuesta 3,2 y redondearla la vuelve cero. */
  costoCop?: number
  /** `wamid` en Meta, `SID` en Twilio. */
  idProveedor?: string | null
  proveedor?: string | null
}

export interface ContactoGuardado extends Omit<ContactoNuevo, 'costoCop' | 'cuerpo'> {
  id: string
  cuerpo: string
  costoCop: number
}

export async function registrarContacto(
  db: Db,
  tenantId: string,
  contacto: ContactoNuevo,
): Promise<{ id: string }> {
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO contactos (tenant_id, obligacion_id, deudor_id, conversacion_id, canal,
                            direccion, ocurrido_en, plantilla_id, cuerpo, resultado,
                            motivo_bloqueo, costo_cop, id_proveedor, proveedor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      tenantId,
      contacto.obligacionId,
      contacto.deudorId,
      contacto.conversacionId ?? null,
      contacto.canal,
      contacto.direccion,
      contacto.timestamp,
      contacto.plantillaId ?? null,
      contacto.cuerpo ?? '',
      contacto.resultado,
      contacto.motivoBloqueo ?? null,
      contacto.costoCop ?? 0,
      contacto.idProveedor ?? null,
      contacto.proveedor ?? null,
    ],
  )
  return { id: fila.id }
}

interface FilaContacto {
  id: string
  obligacion_id: string
  deudor_id: string
  conversacion_id: string | null
  canal: Canal
  direccion: 'saliente' | 'entrante'
  ocurrido_en: Date
  plantilla_id: string | null
  cuerpo: string
  resultado: ResultadoEnvio
  motivo_bloqueo: string | null
  costo_cop: string
  id_proveedor: string | null
  proveedor: string | null
}

/**
 * `costo_cop` es `numeric` y el driver de Postgres lo entrega como string para
 * no perder precisión. Convertirlo acá y no aguas abajo evita que alguien sume
 * strings y obtenga "3.23.2".
 */
function aContacto(f: FilaContacto): ContactoGuardado {
  return {
    id: f.id,
    obligacionId: f.obligacion_id,
    deudorId: f.deudor_id,
    conversacionId: f.conversacion_id,
    canal: f.canal,
    direccion: f.direccion,
    timestamp: f.ocurrido_en instanceof Date ? f.ocurrido_en.toISOString() : String(f.ocurrido_en),
    plantillaId: f.plantilla_id,
    cuerpo: f.cuerpo,
    resultado: f.resultado,
    motivoBloqueo: f.motivo_bloqueo,
    costoCop: Number(f.costo_cop),
    idProveedor: f.id_proveedor,
    proveedor: f.proveedor,
  }
}

const COLUMNAS = `id, obligacion_id, deudor_id, conversacion_id, canal, direccion,
                  ocurrido_en, plantilla_id, cuerpo, resultado, motivo_bloqueo,
                  costo_cop, id_proveedor, proveedor`

/** Todo el historial del deudor en orden cronológico, bloqueados incluidos. */
export async function contactosDelDeudor(
  db: Db,
  tenantId: string,
  deudorId: string,
): Promise<ContactoGuardado[]> {
  const filas = await db.query<FilaContacto>(
    `SELECT ${COLUMNAS} FROM contactos
      WHERE tenant_id = $1 AND deudor_id = $2
      ORDER BY ocurrido_en ASC`,
    [tenantId, deudorId],
  )
  return filas.map(aContacto)
}
