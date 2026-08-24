import type { AvisoBancario } from '@/conciliacion/correo/parser'
import type { Db } from '../db'

/**
 * Los avisos del banco, ya parseados.
 *
 * Cuelgan de `raw_emails`: el crudo se guarda siempre, y esto es su lectura. Si
 * mañana el parser mejora, se puede volver a leer lo que ya llegó — que es todo
 * el motivo por el que no se descarta nada.
 */

export interface AvisoGuardado {
  id: string
  rawEmailId: string
  montoCentavos: number
  remitenteRaw: string | null
  remitenteNorm: string | null
  cuentaUltimos4: string | null
  ocurridoEn: Date
  huella: string
}

export async function guardarAviso(
  db: Db,
  tenantId: string,
  datos: { rawEmailId: string; aviso: AvisoBancario; huella: string },
): Promise<{ id: string }> {
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO bank_notifications
       (tenant_id, raw_email_id, monto_centavos, remitente_raw, remitente_norm,
        cuenta_ultimos4, ocurrido_en, huella)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      tenantId,
      datos.rawEmailId,
      datos.aviso.montoCentavos,
      datos.aviso.remitenteRaw,
      datos.aviso.remitenteNorm,
      datos.aviso.cuentaUltimos4,
      datos.aviso.ocurridoEn.toISOString(),
      datos.huella,
    ],
  )
  return fila
}

/**
 * Otros avisos con la misma huella.
 *
 * El correo del banco **no trae identificador de transacción**, así que la
 * huella se fabrica con monto, remitente, instante y cuenta. Dos personas que
 * pagan lo mismo en el mismo minuto colisionan, y eso pasa de verdad en un
 * negocio con precios redondos.
 *
 * Por eso el índice de `huella` no es único y esto devuelve una lista: los dos
 * avisos existen, los dos se guardan, y los dos van a revisión. Un `UNIQUE`
 * habría perdido el segundo en silencio, que es perder un pago real.
 */
export async function avisosConHuella(
  db: Db,
  tenantId: string,
  huella: string,
): Promise<AvisoGuardado[]> {
  const filas = await db.query<{
    id: string
    raw_email_id: string
    monto_centavos: string
    remitente_raw: string | null
    remitente_norm: string | null
    cuenta_ultimos4: string | null
    ocurrido_en: Date
    huella: string
  }>(
    `SELECT id, raw_email_id, monto_centavos, remitente_raw, remitente_norm,
            cuenta_ultimos4, ocurrido_en, huella
       FROM bank_notifications
      WHERE tenant_id = $1 AND huella = $2
      ORDER BY id`,
    [tenantId, huella],
  )
  return filas.map(aAviso)
}

/**
 * Avisos que podrían ser de un comprobante: mismo monto y todavía sin conciliar.
 *
 * El monto exacto es obligatorio y sin tolerancia, así que filtra en la base y
 * no en memoria. La ventana temporal se evalúa después, en el matcher, contra
 * la hora que leyó el OCR — no contra cuándo llegó la captura, que puede ser
 * tres horas más tarde.
 */
export async function avisosSinConciliarPorMonto(
  db: Db,
  tenantId: string,
  montoCentavos: number,
): Promise<AvisoGuardado[]> {
  const filas = await db.query<{
    id: string
    raw_email_id: string
    monto_centavos: string
    remitente_raw: string | null
    remitente_norm: string | null
    cuenta_ultimos4: string | null
    ocurrido_en: Date
    huella: string
  }>(
    `SELECT n.id, n.raw_email_id, n.monto_centavos, n.remitente_raw, n.remitente_norm,
            n.cuenta_ultimos4, n.ocurrido_en, n.huella
       FROM bank_notifications n
      WHERE n.tenant_id = $1
        AND n.monto_centavos = $2
        AND NOT EXISTS (
          SELECT 1 FROM reconciliations r WHERE r.notification_id = n.id
        )
      ORDER BY n.ocurrido_en`,
    [tenantId, montoCentavos],
  )
  return filas.map(aAviso)
}

function aAviso(f: {
  id: string
  raw_email_id: string
  monto_centavos: string
  remitente_raw: string | null
  remitente_norm: string | null
  cuenta_ultimos4: string | null
  ocurrido_en: Date
  huella: string
}): AvisoGuardado {
  return {
    id: f.id,
    rawEmailId: f.raw_email_id,
    // `bigint` sale como texto del driver: `Number` acá es explícito, y los
    // montos de un aviso bancario están lejísimos del entero seguro.
    montoCentavos: Number(f.monto_centavos),
    remitenteRaw: f.remitente_raw,
    remitenteNorm: f.remitente_norm,
    cuentaUltimos4: f.cuenta_ultimos4,
    ocurridoEn: new Date(f.ocurrido_en),
    huella: f.huella,
  }
}
