import { enBogota } from '@/compliance/reloj-bogota'
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

/**
 * Los últimos seis meses, del más reciente al más viejo. `YYYY-MM`.
 *
 * El mes actual sale de la hora de **Bogotá**, no de UTC. Con `getUTCMonth` el
 * último día del mes, después de las siete de la tarde colombiana, el selector
 * ya mostraba el mes siguiente como actual: cinco horas al mes en que la
 * pantalla contradecía el calendario del que la mira. Y como los bordes sí se
 * calculan en hora de Bogotá, el mes "actual" quedaba vacío.
 */
export function mesesRecientes(hoy: Date, cuantos = 6): string[] {
  const enColombia = enBogota(hoy)
  const salida: string[] = []
  for (let i = 0; i < cuantos; i++) {
    const d = new Date(Date.UTC(enColombia.anio, enColombia.mes - 1 - i, 1))
    salida.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return salida
}

/**
 * El mes en hora de Bogotá, no en UTC.
 *
 * Un mensaje del 31 a las 8 de la noche es UTC del día 1: contarlo en el mes
 * siguiente descuadra la factura contra la del cliente por unas horas al mes.
 */
export function bordesDelMes(mes: string): Periodo {
  const [anio, m] = mes.split('-').map(Number)
  const siguiente = m === 12 ? `${anio + 1}-01` : `${anio}-${String(m + 1).padStart(2, '0')}`
  return { desde: `${mes}-01T00:00:00-05:00`, hasta: `${siguiente}-01T00:00:00-05:00` }
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
 * El resumen del periodo. Todo lo que pasó, sin filtrar por proveedor.
 *
 * Antes excluía `proveedor = 'simulado'` para dejar afuera el botón de demo.
 * Estaba mal por dos lados. Uno: filtraba media conversación — el entrante
 * inyectado sí, pero la respuesta del agente y sus tokens no—, así que el
 * número no era ni "tráfico real" ni "todo el tráfico". Dos: `'simulado'`
 * significa dos cosas distintas, porque `crearProveedores` cae al proveedor
 * simulado cuando faltan las credenciales de Meta. Un cliente desplegado sin
 * `PROVEEDOR_WHATSAPP=meta` veía la pantalla entera en cero y parecía un mes
 * tranquilo, no una configuración rota.
 *
 * Y el filtro tampoco hacía falta: el tráfico de demo solo existe en tenants
 * con `modo_demo`, y ahí mostrar lo que costaría es justamente el punto.
 */
export async function resumenDelPeriodo(
  db: Db,
  tenantId: string,
  periodo: Periodo,
): Promise<ResumenConsumo> {
  // Las tres consultas son independientes y ninguna alimenta a la siguiente.
  // En serie eran tres viajes para pintar una sola pantalla.
  const [filasTotales, porCategoria, porCanal] = await Promise.all([
    db.query<{
      costo: string | null
      cuentan: string
      bloqueados: string
      conversaciones: string
    }>(
      `SELECT COALESCE(SUM(costo_cop), 0)                                   AS costo,
              COUNT(*) FILTER (WHERE resultado <> 'bloqueado')              AS cuentan,
              COUNT(*) FILTER (WHERE resultado =  'bloqueado')              AS bloqueados,
              -- Filtrado igual que las dos de arriba. Sin el FILTER, un deudor
              -- con opt-out generaba conversación y contacto bloqueado y nada
              -- más, y esa "conversación" consumía cupo a COP 180 de excedente
              -- —tres centímetros debajo del texto que dice que los bloqueados
              -- no consumen cupo—. El motor abre el hilo antes de evaluar el
              -- plan, así que el caso es común, no raro.
              COUNT(DISTINCT conversacion_id)
                FILTER (WHERE resultado <> 'bloqueado')                     AS conversaciones
         FROM contactos
        WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3`,
      [tenantId, periodo.desde, periodo.hasta],
    ),

    db.query<{ categoria: CategoriaFacturable; n: string; costo: string }>(
      // `fallido` afuera: no se entregó, no se cobró, y contarlo como mensaje
      // con categoría partía el costo entre uno más. Con un fallido y un
      // entregado, ambos utility, la columna "por mensaje" mostraba COP 1,6 —
      // un precio que no existe en ningún rate card, y es la columna que el
      // cliente compara contra la factura de Meta.
      `SELECT categoria, COUNT(*) AS n, COALESCE(SUM(costo_cop), 0) AS costo
         FROM contactos
        WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3
          AND categoria IS NOT NULL AND resultado <> 'fallido'
        GROUP BY categoria
        ORDER BY costo DESC`,
      [tenantId, periodo.desde, periodo.hasta],
    ),

    db.query<{ canal: Canal; n: string; costo: string }>(
      `SELECT canal, COUNT(*) AS n, COALESCE(SUM(costo_cop), 0) AS costo
         FROM contactos
        WHERE tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3
          AND resultado <> 'bloqueado'
        GROUP BY canal
        ORDER BY costo DESC`,
      [tenantId, periodo.desde, periodo.hasta],
    ),
  ])
  const totales = filasTotales[0]

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
 *
 * El filtro es `paso = 'cerebro'` y no `tokens_in IS NOT NULL`. Un proveedor
 * que no reporta `usage` deja los tokens en NULL, y filtrando por eso el turno
 * desaparecía entero — también del denominador de turnos por conversación, que
 * es justo la cifra que se mira para optimizar. Los pasos de herramienta viven
 * en la misma tabla y no consumen tokens, así que contarlos como turnos
 * inflaría el numerador: por eso tampoco es "todo".
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
        AND paso = 'cerebro'`,
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
