import type { Db } from './db'

/**
 * Correos crudos.
 *
 * `tenantId` va de primer parámetro en toda función y no es una convención de
 * estilo: es la capa que de verdad aísla, porque la service key con la que
 * escribe el worker ignora RLS. Si algún día una función de este archivo no
 * recibe `tenantId`, el aislamiento se rompió ahí.
 */

export interface CorreoCrudo {
  messageId: string
  crudo: string
  fromAddr?: string | null
  subject?: string | null
  dkimOk?: boolean | null
  dkimDomain?: string | null
  cuarentena?: boolean
  motivo?: string | null
}

export interface CorreoGuardado extends CorreoCrudo {
  id: string
  recibidoAt: Date
}

/**
 * Guarda y devuelve el id.
 *
 * `ON CONFLICT DO NOTHING` sobre `(tenant_id, message_id)` porque los MTA
 * reentregan: el mismo correo puede llegar dos veces y la segunda no puede
 * crear una fila nueva ni reventar la ingesta.
 */
export async function guardarCorreoCrudo(
  db: Db,
  tenantId: string,
  correo: CorreoCrudo,
): Promise<{ id: string; duplicado: boolean }> {
  const filas = await db.query<{ id: string }>(
    `INSERT INTO raw_emails (tenant_id, message_id, crudo, from_addr, subject,
                             dkim_ok, dkim_domain, cuarentena, motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, message_id) DO NOTHING
     RETURNING id`,
    [
      tenantId,
      correo.messageId,
      correo.crudo,
      correo.fromAddr ?? null,
      correo.subject ?? null,
      correo.dkimOk ?? null,
      correo.dkimDomain ?? null,
      correo.cuarentena ?? false,
      correo.motivo ?? null,
    ],
  )

  if (filas.length > 0) return { id: filas[0].id, duplicado: false }

  const existente = await db.query<{ id: string }>(
    `SELECT id FROM raw_emails WHERE tenant_id = $1 AND message_id = $2`,
    [tenantId, correo.messageId],
  )
  return { id: existente[0].id, duplicado: true }
}

export async function listarCorreosCrudos(
  db: Db,
  tenantId: string,
): Promise<CorreoGuardado[]> {
  const filas = await db.query<{
    id: string
    message_id: string
    crudo: string
    from_addr: string | null
    subject: string | null
    dkim_ok: boolean | null
    dkim_domain: string | null
    cuarentena: boolean
    motivo: string | null
    recibido_at: Date
  }>(
    `SELECT id, message_id, crudo, from_addr, subject, dkim_ok, dkim_domain,
            cuarentena, motivo, recibido_at
       FROM raw_emails
      WHERE tenant_id = $1
      ORDER BY recibido_at DESC`,
    [tenantId],
  )

  return filas.map((f) => ({
    id: f.id,
    messageId: f.message_id,
    crudo: f.crudo,
    fromAddr: f.from_addr,
    subject: f.subject,
    dkimOk: f.dkim_ok,
    dkimDomain: f.dkim_domain,
    cuarentena: f.cuarentena,
    motivo: f.motivo,
    recibidoAt: f.recibido_at,
  }))
}

/** Cuántos correos quedaron en cuarentena. Un número que sube es alguien probando. */
export async function contarCuarentena(db: Db, tenantId: string): Promise<number> {
  const filas = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM raw_emails WHERE tenant_id = $1 AND cuarentena`,
    [tenantId],
  )
  return filas[0].n
}
