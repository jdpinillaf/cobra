/**
 * Las llamadas, su transcripción y lo que el agente ejecutó en ellas.
 *
 * La fila de `llamadas` es el detalle de cómo fue; la de `contactos` que se
 * escribe al cerrar es lo que **cuenta** ante la SIC y lo que ve el guard al
 * contar frecuencia. Son dos cosas distintas a propósito: borrar el detalle de
 * una llamada no puede borrar la evidencia de que se hizo.
 */
import type { Db } from '../db'
import type { CanalContacto } from '@/domain/types'
import type { TurnoVoz } from '@/voz/agente'
import type { AccionEjecutada } from '@/voz/funciones'
import type { ResultadoLlamada } from '@/voz/resumen'
import { registrarContacto } from './contactos'

export interface LlamadaNueva {
  deudorId: string
  obligacionId: string | null
  conversacionId: string | null
  telefono: string
  direccion: 'saliente' | 'entrante'
  proveedor: 'twilio' | 'simulado'
  idProveedor?: string | null
  agente: string
}

export async function abrirLlamada(
  db: Db,
  tenantId: string,
  l: LlamadaNueva,
): Promise<{ id: string }> {
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO llamadas (tenant_id, deudor_id, obligacion_id, conversacion_id, telefono,
                           direccion, proveedor, id_proveedor, agente, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'en_curso')
     RETURNING id`,
    [
      tenantId,
      l.deudorId,
      l.obligacionId,
      l.conversacionId,
      l.telefono,
      l.direccion,
      l.proveedor,
      l.idProveedor ?? null,
      l.agente,
    ],
  )
  return { id: fila.id }
}

export async function anotarTurno(
  db: Db,
  tenantId: string,
  llamadaId: string,
  t: TurnoVoz & { indice: number },
): Promise<void> {
  await db.query(
    `INSERT INTO llamada_turnos (tenant_id, llamada_id, indice, quien, texto, interrumpido, ms_desde_inicio)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, llamada_id, indice) DO NOTHING`,
    [tenantId, llamadaId, t.indice, t.quien, t.texto, t.interrumpido ?? false, Math.round(t.msDesdeInicio)],
  )
}

export async function marcarInterrumpido(
  db: Db,
  tenantId: string,
  llamadaId: string,
  indice: number,
): Promise<void> {
  await db.query(
    `UPDATE llamada_turnos SET interrumpido = true
      WHERE tenant_id = $1 AND llamada_id = $2 AND indice = $3`,
    [tenantId, llamadaId, indice],
  )
}

export async function anotarAccion(
  db: Db,
  tenantId: string,
  llamadaId: string,
  a: AccionEjecutada & { turnoIndice: number },
): Promise<void> {
  await db.query(
    `INSERT INTO llamada_acciones (tenant_id, llamada_id, turno_indice, herramienta,
                                   argumentos, resultado, estado, latencia_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      tenantId,
      llamadaId,
      a.turnoIndice,
      a.nombre,
      JSON.stringify(a.argumentos ?? {}),
      JSON.stringify(a.salida ?? null),
      a.estado,
      Math.round(a.latenciaMs),
    ],
  )
}

/**
 * Cierra la llamada **y** escribe su `Contacto`, en una transacción.
 *
 * Van juntos porque separarlos deja el peor estado posible: una llamada que
 * ocurrió y no cuenta para el cupo de frecuencia de la Ley 2300. El agente
 * podría llamar y, un minuto después, escribir por WhatsApp sin que nada lo
 * detenga.
 */
export async function cerrarLlamada(
  db: Db,
  tenantId: string,
  llamadaId: string,
  c: {
    motivoFin: string
    estado: 'finalizada' | 'fallida' | 'no_contesto' | 'buzon'
    duracionSeg: number
    resumen: string
    resultado: ResultadoLlamada
    costoTelefoniaCop: number
    costoIaCop: number
    grabacionUrl?: string | null
  },
): Promise<void> {
  await db.transaccion(async (tx) => {
    const [llamada] = await tx.query<{
      deudor_id: string
      obligacion_id: string | null
      conversacion_id: string | null
      telefono: string
      direccion: 'saliente' | 'entrante'
    }>(
      `SELECT deudor_id, obligacion_id, conversacion_id, telefono, direccion
         FROM llamadas WHERE tenant_id = $1 AND id = $2`,
      [tenantId, llamadaId],
    )
    if (!llamada) return

    let contactoId: string | null = null
    if (llamada.conversacion_id) {
      const { id } = await registrarContacto(tx, tenantId, {
        obligacionId: llamada.obligacion_id,
        deudorId: llamada.deudor_id,
        conversacionId: llamada.conversacion_id as string,
        canal: 'voz' as CanalContacto,
        direccion: llamada.direccion,
        timestamp: new Date().toISOString(),
        cuerpo: c.resumen,
        resultado: c.estado === 'finalizada' ? 'entregado' : 'fallido',
        // El costo total va acá: es lo que lee `consumoDelPeriodo`.
        costoCop: c.costoTelefoniaCop + c.costoIaCop,
        // Sin categoría: una llamada no es una plantilla de Meta, y ensuciar
        // el `GROUP BY categoria` de la pantalla de Consumo con un valor
        // inventado haría que las cuentas de mensajería dejen de cuadrar.
        categoria: null,
      })
      contactoId = id
    }

    await tx.query(
      `UPDATE llamadas
          SET estado = $3, motivo_fin = $4, duracion_seg = $5, resumen = $6, resultado = $7,
              costo_telefonia_cop = $8, costo_ia_cop = $9, grabacion_url = $10,
              contacto_id = $11, finalizada_en = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        llamadaId,
        c.estado,
        c.motivoFin,
        c.duracionSeg,
        c.resumen,
        c.resultado,
        c.costoTelefoniaCop,
        c.costoIaCop,
        c.grabacionUrl ?? null,
        contactoId,
      ],
    )
  })
}

export interface LlamadaEnLista {
  id: string
  deudorNombre: string
  telefono: string
  direccion: 'saliente' | 'entrante'
  estado: string
  resultado: ResultadoLlamada | null
  resumen: string | null
  duracionSeg: number | null
  costoCop: number
  proveedor: string
  iniciadaEn: string
  grabacionUrl: string | null
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function listarLlamadas(
  db: Db,
  tenantId: string,
  limite = 100,
): Promise<LlamadaEnLista[]> {
  const filas = await db.query<Record<string, unknown>>(
    `SELECT l.id, l.telefono, l.direccion, l.estado, l.resultado, l.resumen,
            l.duracion_seg, l.costo_telefonia_cop, l.costo_ia_cop, l.proveedor,
            l.iniciada_en, l.grabacion_url, d.nombre AS deudor_nombre
       FROM llamadas l
       JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
      WHERE l.tenant_id = $1
      ORDER BY l.iniciada_en DESC
      LIMIT $2`,
    [tenantId, limite],
  )

  return filas.map((f) => ({
    id: String(f.id),
    deudorNombre: String(f.deudor_nombre),
    telefono: String(f.telefono),
    direccion: f.direccion as 'saliente' | 'entrante',
    estado: String(f.estado),
    resultado: (f.resultado as ResultadoLlamada | null) ?? null,
    resumen: (f.resumen as string | null) ?? null,
    duracionSeg: f.duracion_seg === null ? null : Number(f.duracion_seg),
    costoCop: num(f.costo_telefonia_cop) + num(f.costo_ia_cop),
    proveedor: String(f.proveedor),
    iniciadaEn: new Date(f.iniciada_en as string).toISOString(),
    grabacionUrl: (f.grabacion_url as string | null) ?? null,
  }))
}

export interface LlamadaConDetalle extends LlamadaEnLista {
  turnos: Array<TurnoVoz & { indice: number }>
  acciones: Array<{
    herramienta: string
    argumentos: unknown
    resultado: unknown
    estado: 'ok' | 'bloqueado' | 'error'
    latenciaMs: number | null
    turnoIndice: number | null
  }>
}

export async function llamadaConDetalle(
  db: Db,
  tenantId: string,
  llamadaId: string,
): Promise<LlamadaConDetalle | null> {
  const [cabecera] = await listarPorId(db, tenantId, llamadaId)
  if (!cabecera) return null

  const [turnos, acciones] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT indice, quien, texto, interrumpido, ms_desde_inicio
         FROM llamada_turnos WHERE tenant_id = $1 AND llamada_id = $2 ORDER BY indice`,
      [tenantId, llamadaId],
    ),
    db.query<Record<string, unknown>>(
      `SELECT turno_indice, herramienta, argumentos, resultado, estado, latencia_ms
         FROM llamada_acciones WHERE tenant_id = $1 AND llamada_id = $2 ORDER BY id`,
      [tenantId, llamadaId],
    ),
  ])

  return {
    ...cabecera,
    turnos: turnos.map((t) => ({
      indice: Number(t.indice),
      quien: t.quien as TurnoVoz['quien'],
      texto: String(t.texto),
      interrumpido: Boolean(t.interrumpido),
      msDesdeInicio: Number(t.ms_desde_inicio),
    })),
    acciones: acciones.map((a) => ({
      herramienta: String(a.herramienta),
      argumentos: a.argumentos,
      resultado: a.resultado,
      estado: a.estado as 'ok' | 'bloqueado' | 'error',
      latenciaMs: a.latencia_ms === null ? null : Number(a.latencia_ms),
      turnoIndice: a.turno_indice === null ? null : Number(a.turno_indice),
    })),
  }
}

async function listarPorId(db: Db, tenantId: string, id: string): Promise<LlamadaEnLista[]> {
  const filas = await db.query<Record<string, unknown>>(
    `SELECT l.id, l.telefono, l.direccion, l.estado, l.resultado, l.resumen,
            l.duracion_seg, l.costo_telefonia_cop, l.costo_ia_cop, l.proveedor,
            l.iniciada_en, l.grabacion_url, d.nombre AS deudor_nombre
       FROM llamadas l
       JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
      WHERE l.tenant_id = $1 AND l.id = $2`,
    [tenantId, id],
  )
  return filas.map((f) => ({
    id: String(f.id),
    deudorNombre: String(f.deudor_nombre),
    telefono: String(f.telefono),
    direccion: f.direccion as 'saliente' | 'entrante',
    estado: String(f.estado),
    resultado: (f.resultado as ResultadoLlamada | null) ?? null,
    resumen: (f.resumen as string | null) ?? null,
    duracionSeg: f.duracion_seg === null ? null : Number(f.duracion_seg),
    costoCop: num(f.costo_telefonia_cop) + num(f.costo_ia_cop),
    proveedor: String(f.proveedor),
    iniciadaEn: new Date(f.iniciada_en as string).toISOString(),
    grabacionUrl: (f.grabacion_url as string | null) ?? null,
  }))
}

/**
 * Lo que el briefing necesita de cada llamada, en una consulta.
 *
 * Va acá y no armando `llamadaConDetalle` por cada una: seis llamadas serían
 * dieciocho viajes a la base para pintar una pantalla.
 */
export interface LlamadaConResumen extends LlamadaEnLista {
  acciones: string[]
  dichoPorElDeudor: string[]
}

export async function llamadasConResumen(
  db: Db,
  tenantId: string,
  limite = 30,
): Promise<LlamadaConResumen[]> {
  const filas = await db.query<Record<string, unknown>>(
    `SELECT l.id, l.telefono, l.direccion, l.estado, l.resultado, l.resumen,
            l.duracion_seg, l.costo_telefonia_cop, l.costo_ia_cop, l.proveedor,
            l.iniciada_en, l.grabacion_url, d.nombre AS deudor_nombre,
            COALESCE((SELECT array_agg(a.herramienta ORDER BY a.id)
                        FROM llamada_acciones a
                       WHERE a.tenant_id = l.tenant_id AND a.llamada_id = l.id
                         AND a.estado = 'ok'), '{}') AS acciones,
            COALESCE((SELECT array_agg(t.texto ORDER BY t.indice)
                        FROM llamada_turnos t
                       WHERE t.tenant_id = l.tenant_id AND t.llamada_id = l.id
                         AND t.quien = 'deudor'), '{}') AS dicho
       FROM llamadas l
       JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
      WHERE l.tenant_id = $1 AND l.estado <> 'en_curso'
      ORDER BY l.iniciada_en DESC
      LIMIT $2`,
    [tenantId, limite],
  )

  return filas.map((f) => ({
    id: String(f.id),
    deudorNombre: String(f.deudor_nombre),
    telefono: String(f.telefono),
    direccion: f.direccion as 'saliente' | 'entrante',
    estado: String(f.estado),
    resultado: (f.resultado as LlamadaEnLista['resultado']) ?? null,
    resumen: (f.resumen as string | null) ?? null,
    duracionSeg: f.duracion_seg === null ? null : Number(f.duracion_seg),
    costoCop: num(f.costo_telefonia_cop) + num(f.costo_ia_cop),
    proveedor: String(f.proveedor),
    iniciadaEn: new Date(f.iniciada_en as string).toISOString(),
    grabacionUrl: (f.grabacion_url as string | null) ?? null,
    acciones: (f.acciones as string[]) ?? [],
    dichoPorElDeudor: (f.dicho as string[]) ?? [],
  }))
}
