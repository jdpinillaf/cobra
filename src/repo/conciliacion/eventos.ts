import type { Db } from '../db'

/**
 * La traza de conciliación, en la misma tabla que la de cobranza.
 *
 * `agent_events` no es logging: es la tabla que sostiene el producto. Lo que se
 * le muestra al comerciante cuando pregunta "¿por qué esto quedó en revisión?"
 * sale de acá, y lo que responde "¿por qué no me llegó nada esta semana?"
 * también.
 *
 * Una sola tabla para los dos productos, y `paso` dice de cuál: `parse_email`,
 * `dkim`, `ocr` y `match` son de conciliación; `envio`, `escalado` y `acuerdo`
 * son de cobranza. Partirla en dos habría dado dos vistas de traza, dos
 * consultas de costo y la promesa de observabilidad cumplida a medias.
 *
 * **`bloqueado_por` separa lo que se hizo de lo que no se pudo hacer.** Un
 * correo que cayó en cuarentena es un paso que no ocurrió, y guardarlo como uno
 * más lo escondería entre los que sí.
 */

/** Los pasos de conciliación. Cerrado a propósito: un `paso` libre no se puede agregar. */
export type PasoConciliacion =
  | 'correo_recibido'
  | 'dkim'
  | 'remitente'
  | 'clasificacion'
  | 'parse_email'
  | 'cuenta_destino'
  | 'comprobante_recibido'
  | 'ocr'
  | 'match'
  | 'confirmacion'
  | 'escalado'

export interface EventoConciliacion {
  paso: PasoConciliacion
  /** `ok` o `bloqueado`. Mismo vocabulario que la traza de cobranza. */
  decision: 'ok' | 'bloqueado'
  /** Por qué. Se muestra tal cual en la consola, así que se escribe para leer. */
  motivo: string
  casoId?: string | null
  proveedor?: string | null
  tokensEntrada?: number | null
  tokensSalida?: number | null
  costoUsd?: number | null
  latenciaMs?: number | null
}

export async function anotarEvento(
  db: Db,
  tenantId: string,
  evento: EventoConciliacion,
): Promise<void> {
  await db.query(
    `INSERT INTO agent_events (tenant_id, case_id, paso, decision, motivo, bloqueado_por,
                               proveedor, tokens_in, tokens_out, costo_usd, latencia_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      tenantId,
      evento.casoId ?? null,
      evento.paso,
      evento.decision,
      evento.motivo,
      evento.decision === 'bloqueado' ? evento.paso : null,
      evento.proveedor ?? null,
      evento.tokensEntrada ?? null,
      evento.tokensSalida ?? null,
      evento.costoUsd ?? null,
      evento.latenciaMs ?? null,
    ],
  )
}

export interface EventoVisible {
  paso: string
  decision: string
  motivo: string
  bloqueadoPor: string | null
  creadoEn: Date
}

/** La traza de un caso, en el orden en que ocurrió. Es la vista que se le muestra al cliente. */
export async function eventosDelCaso(
  db: Db,
  tenantId: string,
  casoId: string,
): Promise<EventoVisible[]> {
  const filas = await db.query<{
    paso: string
    decision: string | null
    motivo: string
    bloqueado_por: string | null
    created_at: Date
  }>(
    `SELECT paso, decision, motivo, bloqueado_por, created_at
       FROM agent_events
      WHERE tenant_id = $1 AND case_id = $2
      ORDER BY id`,
    [tenantId, casoId],
  )

  return filas.map((f) => ({
    paso: f.paso,
    decision: f.decision ?? '',
    motivo: f.motivo,
    bloqueadoPor: f.bloqueado_por,
    creadoEn: f.created_at,
  }))
}
