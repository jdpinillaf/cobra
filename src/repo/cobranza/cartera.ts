import type { Deudor, EstadoObligacion, Obligacion, TramoMora } from '@/domain/types'
import type { Db } from '../db'

/**
 * Persistencia de la cartera.
 *
 * Acá vive la frontera entre las dos convenciones de dinero del sistema: el
 * dominio trabaja en **pesos enteros** y el esquema en **centavos**. Convertir
 * en el repositorio, y no migrando los tipos, es lo que permite que los tests
 * del motor sigan sin tocarse. Aguas afuera nadie ve un centavo.
 *
 * La cartera se **sincroniza**, no se importa una sola vez: el cliente corre la
 * carga todos los días y los saldos cambian. Por eso todo es idempotente por
 * llave natural — documento para el deudor, número de crédito para la
 * obligación. Si cada corrida insertara de nuevo, a la semana el agente le
 * estaría escribiendo siete veces al mismo deudor.
 */

const aCentavos = (pesos: number): number => Math.round(pesos * 100)
const aPesos = (centavos: string | number): number => Math.round(Number(centavos) / 100)

export interface CarteraParaGuardar {
  deudores: Deudor[]
  obligaciones: Obligacion[]
}

export interface ResumenCarga {
  /** Cuántos deudores eran nuevos. En una resincronización debería dar 0. */
  deudores: number
  obligaciones: number
  actualizadas: number
}

export async function guardarCartera(
  db: Db,
  tenantId: string,
  cartera: CarteraParaGuardar,
): Promise<ResumenCarga> {
  const resumen: ResumenCarga = { deudores: 0, obligaciones: 0, actualizadas: 0 }
  // El id del dominio es del archivo de origen, no de la base. Este mapa
  // traduce uno al otro para poder colgar las obligaciones del deudor correcto.
  const idPorDocumento = new Map<string, string>()

  for (const d of cartera.deudores) {
    const [fila] = await db.query<{ id: string; inserto: boolean }>(
      `INSERT INTO deudores (tenant_id, tipo_documento, documento, nombre, telefonos, email, rol,
                             consentimiento_otorgado, consentimiento_fuente, consentimiento_fecha,
                             revocado_en, pref_canal, pref_dia_semana, pref_hora_desde, pref_hora_hasta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, tipo_documento, documento) DO UPDATE
         SET nombre = EXCLUDED.nombre, telefonos = EXCLUDED.telefonos, email = EXCLUDED.email
       RETURNING id, (xmax = 0) AS inserto`,
      [
        tenantId,
        d.tipoDocumento,
        d.documento,
        d.nombre,
        d.telefonos,
        d.email ?? null,
        d.rol,
        d.consentimiento.otorgado,
        d.consentimiento.fuente ?? null,
        d.consentimiento.fecha ?? null,
        // El opt-out no se pisa nunca desde una recarga de cartera: si el
        // deudor pidió la baja, un archivo del cliente no puede revivirlo.
        d.consentimiento.revocadoEn ?? null,
        d.preferencia?.canal ?? null,
        d.preferencia?.diaSemana ?? null,
        d.preferencia?.horaDesde ?? null,
        d.preferencia?.horaHasta ?? null,
      ],
    )
    idPorDocumento.set(`${d.tipoDocumento}:${d.documento}`, fila.id)
    idPorDocumento.set(d.id, fila.id)
    if (fila.inserto) resumen.deudores += 1
  }

  for (const o of cartera.obligaciones) {
    const deudorId = idPorDocumento.get(o.deudorId)
    if (!deudorId) continue

    const [fila] = await db.query<{ inserto: boolean }>(
      `INSERT INTO obligaciones (tenant_id, deudor_id, numero_credito, capital_centavos,
                                 interes_mora_centavos, saldo_total_centavos, fecha_vencimiento,
                                 dias_mora, tramo, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, numero_credito) DO UPDATE
         SET saldo_total_centavos  = EXCLUDED.saldo_total_centavos,
             interes_mora_centavos = EXCLUDED.interes_mora_centavos,
             dias_mora             = EXCLUDED.dias_mora,
             tramo                 = EXCLUDED.tramo,
             estado                = EXCLUDED.estado
       RETURNING (xmax = 0) AS inserto`,
      [
        tenantId,
        deudorId,
        o.numeroCredito,
        aCentavos(o.capital),
        aCentavos(o.interesMora),
        aCentavos(o.saldoTotal),
        o.fechaVencimiento,
        o.diasMora,
        o.tramo,
        o.estado,
      ],
    )
    if (fila.inserto) resumen.obligaciones += 1
    else resumen.actualizadas += 1
  }

  return resumen
}

export interface ObligacionConDeudor {
  id: string
  deudorId: string
  deudorNombre: string
  telefono: string | null
  numeroCredito: string
  capital: number
  interesMora: number
  saldoTotal: number
  fechaVencimiento: string
  diasMora: number
  tramo: TramoMora
  estado: EstadoObligacion
  /** `false` si el deudor pidió la baja. El guard lo bloquea igual, pero la consola lo muestra. */
  contactable: boolean
}

export async function listarObligaciones(
  db: Db,
  tenantId: string,
  filtro: { tramo?: TramoMora; estado?: EstadoObligacion } = {},
): Promise<ObligacionConDeudor[]> {
  const filas = await db.query<{
    id: string
    deudor_id: string
    nombre: string
    telefonos: string[]
    numero_credito: string
    capital_centavos: string
    interes_mora_centavos: string
    saldo_total_centavos: string
    fecha_vencimiento: Date | string
    dias_mora: number
    tramo: TramoMora
    estado: EstadoObligacion
    consentimiento_otorgado: boolean
    revocado_en: Date | null
  }>(
    `SELECT o.id, o.deudor_id, d.nombre, d.telefonos, o.numero_credito,
            o.capital_centavos, o.interes_mora_centavos, o.saldo_total_centavos,
            o.fecha_vencimiento, o.dias_mora, o.tramo, o.estado,
            d.consentimiento_otorgado, d.revocado_en
       FROM obligaciones o
       JOIN deudores d ON d.id = o.deudor_id AND d.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1
        AND ($2::text IS NULL OR o.tramo = $2)
        AND ($3::text IS NULL OR o.estado = $3)
      ORDER BY o.dias_mora DESC, o.saldo_total_centavos DESC`,
    [tenantId, filtro.tramo ?? null, filtro.estado ?? null],
  )

  return filas.map((f) => ({
    id: f.id,
    deudorId: f.deudor_id,
    deudorNombre: f.nombre,
    telefono: f.telefonos[0] ?? null,
    numeroCredito: f.numero_credito,
    capital: aPesos(f.capital_centavos),
    interesMora: aPesos(f.interes_mora_centavos),
    saldoTotal: aPesos(f.saldo_total_centavos),
    fechaVencimiento:
      f.fecha_vencimiento instanceof Date
        ? f.fecha_vencimiento.toISOString().slice(0, 10)
        : String(f.fecha_vencimiento).slice(0, 10),
    diasMora: f.dias_mora,
    tramo: f.tramo,
    estado: f.estado,
    contactable: f.consentimiento_otorgado && f.revocado_en === null,
  }))
}
