import type { Db } from './db'

/**
 * Correos crudos.
 *
 * `tenantId` va de primer parámetro en toda función y no es una convención de
 * estilo: es la capa que de verdad aísla, porque la service key con la que
 * escribe el worker ignora RLS. Si algún día una función de este archivo no
 * recibe `tenantId`, el aislamiento se rompió ahí.
 */

export type Clasificacion = 'ingreso' | 'egreso' | 'seguridad' | 'otro' | 'desconocido'

export interface CorreoCrudo {
  messageId: string
  crudo: string
  fromAddr?: string | null
  subject?: string | null
  dkimOk?: boolean | null
  dkimDomain?: string | null
  cuarentena?: boolean
  motivo?: string | null
  clasificacion?: Clasificacion | null
  /** `false` es el disparador de la alerta: el banco cambió la redacción. */
  parseOk?: boolean | null
  /** La hora que dice el aviso, no la hora en que llegó el correo. */
  bancoAt?: Date | null
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
                             dkim_ok, dkim_domain, cuarentena, motivo,
                             clasificacion, parse_ok, banco_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      correo.clasificacion ?? null,
      correo.parseOk ?? null,
      correo.bancoAt?.toISOString() ?? null,
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

/**
 * ¿Ya vimos este correo?
 *
 * Los MTA reentregan y la gente reenvía. Se pregunta antes de trabajar para no
 * gastar una verificación de firma —que hace consultas de DNS— en algo que ya
 * está guardado.
 */
export async function correoYaVisto(
  db: Db,
  tenantId: string,
  messageId: string,
): Promise<boolean> {
  const filas = await db.query<{ id: string }>(
    `SELECT id FROM raw_emails WHERE tenant_id = $1 AND message_id = $2`,
    [tenantId, messageId],
  )
  return filas.length > 0
}

/**
 * Correos que llegaron y no se pudieron parsear.
 *
 * El detector más urgente de los tres: si esto devuelve algo, Bancolombia
 * cambió la redacción y todos los clientes se quedan sin conciliar el mismo
 * día. No hay diversificación de bancos que amortigüe.
 */
export async function correosSinParsear(
  db: Db,
  tenantId: string,
  desde: Date,
): Promise<Array<{ id: string; subject: string | null; recibidoAt: Date }>> {
  const filas = await db.query<{ id: string; subject: string | null; recibido_at: Date }>(
    `SELECT id, subject, recibido_at
       FROM raw_emails
      WHERE tenant_id = $1 AND parse_ok = false AND recibido_at >= $2
      ORDER BY recibido_at DESC`,
    [tenantId, desde.toISOString()],
  )
  return filas.map((f) => ({ id: f.id, subject: f.subject, recibidoAt: f.recibido_at }))
}

/**
 * Cuándo llegó el último correo, para el heartbeat.
 *
 * `null` significa que no llegó ninguno **nunca**, que en el onboarding es lo
 * normal y a los tres días es la falla más probable del producto: el reenvío de
 * Gmail se murió y nadie se entera, porque el sistema no distingue "hoy no hubo
 * pagos" de "hace tres días que no llega nada".
 */
export async function ultimoCorreoEn(db: Db, tenantId: string): Promise<Date | null> {
  const filas = await db.query<{ ultimo: Date | null }>(
    `SELECT max(recibido_at) AS ultimo FROM raw_emails WHERE tenant_id = $1`,
    [tenantId],
  )
  return filas[0]?.ultimo ?? null
}

/** Cuántos correos quedaron en cuarentena. Un número que sube es alguien probando. */
export async function contarCuarentena(db: Db, tenantId: string): Promise<number> {
  const filas = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM raw_emails WHERE tenant_id = $1 AND cuarentena`,
    [tenantId],
  )
  return filas[0].n
}
