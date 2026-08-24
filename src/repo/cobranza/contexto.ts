import type { Cadencia, Contacto, Deudor, Obligacion, PasoCadencia } from '@/domain/types'
import type { Db } from '../db'

/**
 * Arma los argumentos que el motor de cadencia ya sabía recibir.
 *
 * `planificarEnvio` y `evaluar` son funciones puras escritas y probadas desde
 * antes de que existiera la base. No cambian de firma: este módulo traduce filas
 * de Postgres a los tipos del dominio y nada más. Es la diferencia entre cablear
 * y reescribir.
 *
 * Acá vive la vuelta de la conversión de dinero: la base guarda centavos y el
 * dominio trabaja en pesos enteros.
 */

const aPesos = (centavos: string | number): number => Math.round(Number(centavos) / 100)

export interface ContextoObligacion {
  deudor: Deudor
  obligacion: Obligacion
  /** Todo el historial del deudor: el guard cuenta frecuencia cruzando canales. */
  contactosDelDeudor: Contacto[]
}

export async function cargarContexto(
  db: Db,
  tenantId: string,
  obligacionId: string,
): Promise<ContextoObligacion | null> {
  const filas = await db.query<Record<string, unknown>>(
    `SELECT o.id AS o_id, o.numero_credito, o.capital_centavos, o.interes_mora_centavos,
            o.saldo_total_centavos, o.fecha_vencimiento, o.dias_mora, o.tramo, o.estado,
            d.id AS d_id, d.tipo_documento, d.documento, d.nombre, d.telefonos, d.email, d.rol,
            d.consentimiento_otorgado, d.consentimiento_fuente, d.consentimiento_fecha,
            d.revocado_en, d.numero_errado_en,
            d.pref_canal, d.pref_dia_semana, d.pref_hora_desde, d.pref_hora_hasta
       FROM obligaciones o
       JOIN deudores d ON d.id = o.deudor_id AND d.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, obligacionId],
  )
  if (filas.length === 0) return null

  const f = filas[0] as unknown as {
    o_id: string; numero_credito: string
    capital_centavos: string; interes_mora_centavos: string; saldo_total_centavos: string
    fecha_vencimiento: Date | string; dias_mora: number; tramo: Obligacion['tramo']
    estado: Obligacion['estado']
    d_id: string; tipo_documento: Deudor['tipoDocumento']; documento: string; nombre: string
    telefonos: string[]; email: string | null; rol: Deudor['rol']
    consentimiento_otorgado: boolean; consentimiento_fuente: string | null
    consentimiento_fecha: Date | null; revocado_en: Date | null
    pref_canal: 'whatsapp' | 'sms' | null; pref_dia_semana: number | null
    pref_hora_desde: number | null; pref_hora_hasta: number | null
    numero_errado_en: Date | null
  }

  const fechaISO = (v: Date | string | null): string | null =>
    v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)

  const deudor: Deudor = {
    id: f.d_id,
    clienteId: tenantId,
    tipoDocumento: f.tipo_documento,
    documento: f.documento,
    nombre: f.nombre,
    telefonos: f.telefonos,
    email: f.email,
    rol: f.rol,
    consentimiento: {
      otorgado: f.consentimiento_otorgado,
      fuente: (f.consentimiento_fuente ?? 'importado') as Deudor['consentimiento']['fuente'],
      fecha: fechaISO(f.consentimiento_fecha) ?? '2000-01-01',
      revocadoEn: f.revocado_en ? new Date(f.revocado_en).toISOString() : null,
    },
    preferencia: {
      canal: f.pref_canal,
      diaSemana: f.pref_dia_semana,
      horaDesde: f.pref_hora_desde,
      horaHasta: f.pref_hora_hasta,
    },
    numeroErradoEn: f.numero_errado_en ? new Date(f.numero_errado_en).toISOString() : null,
  }

  const obligacion: Obligacion = {
    id: f.o_id,
    clienteId: tenantId,
    deudorId: f.d_id,
    numeroCredito: f.numero_credito,
    capital: aPesos(f.capital_centavos),
    interesMora: aPesos(f.interes_mora_centavos),
    saldoTotal: aPesos(f.saldo_total_centavos),
    fechaVencimiento: fechaISO(f.fecha_vencimiento) ?? '2000-01-01',
    diasMora: f.dias_mora,
    tramo: f.tramo,
    estado: f.estado,
  }

  const contactos = await db.query<{
    id: string; obligacion_id: string; canal: Contacto['canal']
    direccion: Contacto['direccion']; ocurrido_en: Date; plantilla_id: string | null
    cuerpo: string; resultado: Contacto['resultado']; motivo_bloqueo: string | null
    costo_cop: string; id_proveedor: string | null; proveedor: string | null
  }>(
    `SELECT id, obligacion_id, canal, direccion, ocurrido_en, plantilla_id, cuerpo,
            resultado, motivo_bloqueo, costo_cop, id_proveedor, proveedor
       FROM contactos WHERE tenant_id = $1 AND deudor_id = $2
      ORDER BY ocurrido_en ASC`,
    [tenantId, f.d_id],
  )

  return {
    deudor,
    obligacion,
    contactosDelDeudor: contactos.map((c) => ({
      id: c.id,
      clienteId: tenantId,
      obligacionId: c.obligacion_id,
      deudorId: f.d_id,
      canal: c.canal,
      direccion: c.direccion,
      timestamp: new Date(c.ocurrido_en).toISOString(),
      plantillaId: c.plantilla_id,
      cuerpo: c.cuerpo,
      resultado: c.resultado,
      motivoBloqueo: c.motivo_bloqueo,
      costoCop: Number(c.costo_cop),
      idProveedor: c.id_proveedor,
      proveedor: c.proveedor,
    })),
  }
}

/** La cadencia del tramo, o `null` si el cliente no configuró ese tramo. */
export async function cadenciaDelTramo(
  db: Db,
  tenantId: string,
  tramo: Obligacion['tramo'],
): Promise<Cadencia | null> {
  const filas = await db.query<{ id: string; pasos: PasoCadencia[]; activa: boolean }>(
    `SELECT id, pasos, activa FROM cadencias WHERE tenant_id = $1 AND tramo = $2`,
    [tenantId, tramo],
  )
  if (filas.length === 0) return null

  return {
    id: filas[0].id,
    clienteId: tenantId,
    tramo,
    pasos: filas[0].pasos,
    activa: filas[0].activa,
  }
}

export async function pasosEjecutados(
  db: Db,
  tenantId: string,
  obligacionId: string,
): Promise<Set<number>> {
  const filas = await db.query<{ indice_paso: number }>(
    `SELECT indice_paso FROM cadencia_ejecuciones WHERE tenant_id = $1 AND obligacion_id = $2`,
    [tenantId, obligacionId],
  )
  return new Set(filas.map((f) => f.indice_paso))
}

/**
 * Marca el paso como hecho.
 *
 * El UNIQUE de la tabla es lo que impide mandar dos veces el mismo paso: si dos
 * corridas del cron se pisan, la segunda choca y no duplica el mensaje.
 */
export async function marcarPasoEjecutado(
  db: Db,
  tenantId: string,
  obligacionId: string,
  indice: number,
): Promise<boolean> {
  const filas = await db.query<{ indice_paso: number }>(
    `INSERT INTO cadencia_ejecuciones (tenant_id, obligacion_id, indice_paso)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING indice_paso`,
    [tenantId, obligacionId, indice],
  )
  return filas.length > 0
}
