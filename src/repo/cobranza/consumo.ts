import type { Canal } from '@/domain/types'
import type { CategoriaFacturable } from '@/channels/tarifas'
import type { Db } from '../db'

/**
 * Lo que se gastó y lo que se consumió.
 *
 * **Son dos números distintos y mezclarlos es el error caro.** La cabecera de
 * `src/domain/planes.ts` ya lo advierte:
 *
 *   *"El cupo de mensajes cuenta entrantes y salientes. La regla nació cuando el
 *   canal iba por un revendedor que cobraba ambos; con Meta Cloud API directo el
 *   tráfico conversacional es gratis, así que el cupo dejó de recuperar costo y
 *   pasó a ser margen. Bajar el cupo hoy no evita un costo, cede margen."*
 *
 * Así que:
 *
 *   costo    `SUM(costo_cop)`. Lo que se le paga a Meta y a Twilio.
 *   consumo  mensajes que cuentan contra el cupo vendido. Es margen.
 *
 * Un tercer número, aparte: el costo de IA, que se mide **por conversación**
 * porque es la unidad que se factura.
 *
 * Todo se agrega en SQL y no en JavaScript. No es preferencia: traerse un mes de
 * `contactos` a memoria para sumarlo funciona con la cartera sembrada y deja de
 * funcionar con la primera real.
 */

/** `numeric` vuelve del driver como cadena. Sumarlo sin castear concatena. */
const num = (v: string | number | null): number => (v === null ? 0 : Number(v))

export interface Periodo {
  /** ISO. Inclusive. */
  desde: string
  /** ISO. Exclusive: evita el borde de medianoche del último día. */
  hasta: string
}

export interface ResumenConsumo {
  /** Lo que hay que pagarle a los proveedores. */
  costoCop: number
  /** Entrantes y salientes no bloqueados: lo que consume cupo. */
  mensajesQueCuentan: number
  /** Salientes que la ley impidió. No cuestan ni consumen, pero son la evidencia. */
  bloqueados: number
  /** Conversaciones distintas con actividad en el periodo. */
  conversaciones: number
  porCategoria: Array<{ categoria: CategoriaFacturable; mensajes: number; costoCop: number }>
  porCanal: Array<{ canal: Canal; mensajes: number; costoCop: number }>
}

/**
 * El resumen del periodo.
 *
 * Excluye lo simulado. Un mensaje que nos inventamos desde el botón de demo no
 * se le cobra a nadie, y contarlo acá haría que la pantalla que mide el negocio
 * mida también nuestros ensayos.
 */
export async function resumenDelPeriodo(
  db: Db,
  tenantId: string,
  periodo: Periodo,
): Promise<ResumenConsumo> {
  const [totales] = await db.query<{
    costo: string | null
    cuentan: string
    bloqueados: string
    conversaciones: string
  }>(
    `SELECT COALESCE(SUM(costo_cop), 0)                                   AS costo,
            COUNT(*) FILTER (WHERE resultado <> 'bloqueado')              AS cuentan,
            COUNT(*) FILTER (WHERE resultado =  'bloqueado')              AS bloqueados,
            COUNT(DISTINCT conversacion_id)                               AS conversaciones
       FROM contactos
      WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3
        AND proveedor IS DISTINCT FROM 'simulado'`,
    [tenantId, periodo.desde, periodo.hasta],
  )

  const porCategoria = await db.query<{ categoria: CategoriaFacturable; n: string; costo: string }>(
    `SELECT categoria, COUNT(*) AS n, COALESCE(SUM(costo_cop), 0) AS costo
       FROM contactos
      WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3
        AND categoria IS NOT NULL AND proveedor IS DISTINCT FROM 'simulado'
      GROUP BY categoria
      ORDER BY costo DESC`,
    [tenantId, periodo.desde, periodo.hasta],
  )

  const porCanal = await db.query<{ canal: Canal; n: string; costo: string }>(
    `SELECT canal, COUNT(*) AS n, COALESCE(SUM(costo_cop), 0) AS costo
       FROM contactos
      WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3
        AND resultado <> 'bloqueado' AND proveedor IS DISTINCT FROM 'simulado'
      GROUP BY canal
      ORDER BY costo DESC`,
    [tenantId, periodo.desde, periodo.hasta],
  )

  return {
    costoCop: num(totales.costo),
    mensajesQueCuentan: Number(totales.cuentan),
    bloqueados: Number(totales.bloqueados),
    conversaciones: Number(totales.conversaciones),
    porCategoria: porCategoria.map((f) => ({
      categoria: f.categoria,
      mensajes: Number(f.n),
      costoCop: num(f.costo),
    })),
    porCanal: porCanal.map((f) => ({
      canal: f.canal,
      mensajes: Number(f.n),
      costoCop: num(f.costo),
    })),
  }
}

export interface ConsumoIaDelPeriodo {
  turnos: number
  conversaciones: number
  tokensEntrada: number
  tokensSalida: number
  /** Milisegundos. Lo que tarda el agente en contestar es parte de la experiencia. */
  latenciaMedianaMs: number | null
}

/**
 * Lo que costó pensar.
 *
 * Se cuentan turnos y conversaciones por separado a propósito: el precio se
 * negocia por conversación, y una conversación de doce turnos y una de uno
 * valen lo mismo para el cliente y muy distinto para nosotros. Esa brecha es
 * exactamente lo que hay que mirar para optimizar.
 */
export async function consumoIaDelPeriodo(
  db: Db,
  tenantId: string,
  periodo: Periodo,
): Promise<ConsumoIaDelPeriodo> {
  const [fila] = await db.query<{
    turnos: string
    conversaciones: string
    entrada: string | null
    salida: string | null
    latencia: string | null
  }>(
    `SELECT COUNT(*)                                    AS turnos,
            COUNT(DISTINCT conversacion_id)             AS conversaciones,
            COALESCE(SUM(tokens_in), 0)                 AS entrada,
            COALESCE(SUM(tokens_out), 0)                AS salida,
            percentile_disc(0.5) WITHIN GROUP (ORDER BY latencia_ms) AS latencia
       FROM agent_events
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
        AND tokens_in IS NOT NULL`,
    [tenantId, periodo.desde, periodo.hasta],
  )

  return {
    turnos: Number(fila.turnos),
    conversaciones: Number(fila.conversaciones),
    tokensEntrada: num(fila.entrada),
    tokensSalida: num(fila.salida),
    latenciaMedianaMs: fila.latencia === null ? null : Number(fila.latencia),
  }
}

export interface CupoDelCliente {
  conversacionesMes: number
  plantillasMes: number
  excedenteConversacionCop: number
  excedentePlantillaCop: number
  umbralAvisoPct: number
}

/**
 * Lo que se le vendió al cliente.
 *
 * Dos cubos, no uno: conversaciones y plantillas se cuentan y se exceden por
 * separado. La migración que los creó lo dice sin vueltas — *"`cupo_mensajes_mes`
 * (un solo cubo) no puede facturar el excedente que se vendió"*.
 */
export async function cupoDelCliente(db: Db, tenantId: string): Promise<CupoDelCliente | null> {
  const [fila] = await db.query<{
    cupo_conversaciones_mes: number
    cupo_plantillas_mes: number
    excedente_conversacion_cop: number
    excedente_plantilla_cop: number
    umbral_aviso_pct: number
  }>(
    `SELECT cupo_conversaciones_mes, cupo_plantillas_mes, excedente_conversacion_cop,
            excedente_plantilla_cop, umbral_aviso_pct
       FROM tenant_cobranza WHERE tenant_id = $1`,
    [tenantId],
  )
  if (!fila) return null

  return {
    conversacionesMes: fila.cupo_conversaciones_mes,
    plantillasMes: fila.cupo_plantillas_mes,
    excedenteConversacionCop: fila.excedente_conversacion_cop,
    excedentePlantillaCop: fila.excedente_plantilla_cop,
    umbralAvisoPct: fila.umbral_aviso_pct,
  }
}
