import type { Canal, ResultadoEnvio } from '@/domain/types'
import type { Db } from '../db'

/**
 * La bandeja.
 *
 * Un deudor tiene **una** conversación viva, no una por mensaje: si cada
 * entrante abriera hilo, la bandeja se vuelve ilegible en un día. Eso lo
 * garantiza el índice único parcial de la migración, no este código.
 *
 * El hilo mezcla mensajes y notas internas en una sola línea de tiempo, porque
 * así es como el asesor lo lee. Devolverlos por separado invita a construir la
 * pantalla con dos pestañas, y entonces la nota que explica por qué no se
 * volvió a llamar queda escondida detrás de un clic que nadie da.
 */

export interface FilaBandeja {
  id: string
  deudorId: string
  deudorNombre: string
  telefono: string | null
  ultimoMensajeEn: string | null
  ultimoMensaje: string | null
  agentePausado: boolean
  motivoPausa: string | null
  asignadaA: string | null
  asignadaNombre: string | null
  /** Por persona: que otro lo haya leído no te lo marca a vos. */
  sinLeer: boolean
  etiquetas: Array<{ nombre: string; tono: string }>
}

export type FiltroBandeja = 'todas' | 'mias' | 'sin_asignar' | 'pausadas'

export async function abrirOReutilizar(
  db: Db,
  tenantId: string,
  params: { deudorId: string; obligacionId?: string | null; ahora: string },
): Promise<{ id: string; nueva: boolean }> {
  const abiertas = await db.query<{ id: string }>(
    `SELECT id FROM conversaciones
      WHERE tenant_id = $1 AND deudor_id = $2 AND cerrada_en IS NULL`,
    [tenantId, params.deudorId],
  )
  if (abiertas.length > 0) return { id: abiertas[0].id, nueva: false }

  // `ON CONFLICT` con el WHERE del índice parcial repetido: sin esa cláusula
  // Postgres no infiere un índice parcial y el INSERT levanta 23505.
  //
  // Hace falta porque el SELECT de arriba no alcanza bajo concurrencia: dos
  // entrantes del mismo deudor al mismo tiempo pasan los dos por el SELECT y
  // los dos intentan insertar. El índice único convertía esa carrera en un
  // error; con esto la convierte en lo que se quería, que es reutilizar.
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO conversaciones (tenant_id, deudor_id, obligacion_id, abierta_en)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, deudor_id) WHERE cerrada_en IS NULL DO NOTHING
     RETURNING id`,
    [tenantId, params.deudorId, params.obligacionId ?? null, params.ahora],
  )
  if (fila) return { id: fila.id, nueva: true }

  // Perdimos la carrera: la abrió el otro.
  const [existente] = await db.query<{ id: string }>(
    `SELECT id FROM conversaciones
      WHERE tenant_id = $1 AND deudor_id = $2 AND cerrada_en IS NULL`,
    [tenantId, params.deudorId],
  )
  return { id: existente.id, nueva: false }
}

export async function pausarAgente(
  db: Db,
  tenantId: string,
  conversacionId: string,
  params: { usuarioId: string | null; motivo?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE conversaciones
        SET agente_pausado = true, pausada_por = $3, pausada_en = now(), motivo_pausa = $4
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversacionId, params.usuarioId, params.motivo ?? null],
  )
}

export async function reanudarAgente(
  db: Db,
  tenantId: string,
  conversacionId: string,
): Promise<void> {
  // Se conserva `pausada_por` y `pausada_en`: quién frenó al agente y cuándo es
  // parte de la historia del caso, y borrarlo al reanudar la pierde.
  await db.query(
    `UPDATE conversaciones SET agente_pausado = false, motivo_pausa = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversacionId],
  )
}

export async function asignar(
  db: Db,
  tenantId: string,
  conversacionId: string,
  usuarioId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE conversaciones SET asignada_a = $3, asignada_en = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversacionId, usuarioId],
  )
}

export async function marcarLeida(
  db: Db,
  tenantId: string,
  conversacionId: string,
  usuarioId: string,
  hasta: string,
): Promise<void> {
  await db.query(
    `INSERT INTO lecturas (tenant_id, conversacion_id, usuario_id, leido_hasta)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, conversacion_id, usuario_id) DO UPDATE
       SET leido_hasta = GREATEST(lecturas.leido_hasta, EXCLUDED.leido_hasta)`,
    [tenantId, conversacionId, usuarioId, hasta],
  )
}

export async function listarBandeja(
  db: Db,
  tenantId: string,
  params: { usuarioId: string; filtro?: FiltroBandeja },
): Promise<FilaBandeja[]> {
  const filtro = params.filtro ?? 'todas'

  const filas = await db.query<{
    id: string
    deudor_id: string
    nombre: string
    telefonos: string[]
    ultimo_mensaje_en: Date | null
    ultimo_mensaje: string | null
    agente_pausado: boolean
    motivo_pausa: string | null
    asignada_a: string | null
    asignada_nombre: string | null
    sin_leer: boolean
    etiquetas: Array<{ nombre: string; tono: string }>
  }>(
    `SELECT c.id, c.deudor_id, d.nombre, d.telefonos,
            c.ultimo_mensaje_en, c.agente_pausado, c.motivo_pausa,
            c.asignada_a, u.nombre AS asignada_nombre,
            -- Sin leer con una comparación, no con un COUNT sobre contactos.
            (c.ultimo_entrante_en IS NOT NULL
             AND (l.leido_hasta IS NULL OR c.ultimo_entrante_en > l.leido_hasta)) AS sin_leer,
            (SELECT ct.cuerpo FROM contactos ct
              WHERE ct.tenant_id = c.tenant_id AND ct.conversacion_id = c.id
              ORDER BY ct.ocurrido_en DESC LIMIT 1) AS ultimo_mensaje,
            COALESCE((SELECT json_agg(json_build_object('nombre', e.nombre, 'tono', e.tono))
                        FROM conversacion_etiquetas ce
                        JOIN etiquetas e ON e.id = ce.etiqueta_id AND e.tenant_id = ce.tenant_id
                       WHERE ce.tenant_id = c.tenant_id AND ce.conversacion_id = c.id), '[]') AS etiquetas
       FROM conversaciones c
       JOIN deudores d
         ON d.id = c.deudor_id AND d.tenant_id = c.tenant_id
       LEFT JOIN tenant_usuarios u
         ON u.id = c.asignada_a AND u.tenant_id = c.tenant_id
       LEFT JOIN lecturas l
         ON l.conversacion_id = c.id AND l.tenant_id = c.tenant_id AND l.usuario_id = $2
      WHERE c.tenant_id = $1
        AND c.cerrada_en IS NULL
        AND ($3 <> 'mias'        OR c.asignada_a = $2)
        AND ($3 <> 'sin_asignar' OR c.asignada_a IS NULL)
        AND ($3 <> 'pausadas'    OR c.agente_pausado)
      ORDER BY c.ultimo_mensaje_en DESC NULLS LAST, c.abierta_en DESC`,
    [tenantId, params.usuarioId, filtro],
  )

  return filas.map((f) => ({
    id: f.id,
    deudorId: f.deudor_id,
    deudorNombre: f.nombre,
    telefono: f.telefonos[0] ?? null,
    ultimoMensajeEn: f.ultimo_mensaje_en ? new Date(f.ultimo_mensaje_en).toISOString() : null,
    ultimoMensaje: f.ultimo_mensaje,
    agentePausado: f.agente_pausado,
    motivoPausa: f.motivo_pausa,
    asignadaA: f.asignada_a,
    asignadaNombre: f.asignada_nombre,
    sinLeer: f.sin_leer,
    etiquetas: f.etiquetas ?? [],
  }))
}

export interface EntradaHilo {
  tipo: 'mensaje' | 'nota'
  id: string
  ocurridoEn: string
  cuerpo: string
  /** Solo en mensajes. */
  direccion?: 'entrante' | 'saliente'
  canal?: Canal
  resultado?: ResultadoEnvio
  motivoBloqueo?: string | null
  /** Solo en notas. */
  autorId?: string | null
}

/**
 * El hilo completo, en orden.
 *
 * Incluye los intentos **bloqueados por ley**. No es un detalle de auditoría
 * escondido en otra pantalla: que el sistema no haya escrito un domingo es
 * justamente lo que el cliente le muestra a la SIC, y el asesor necesita verlo
 * para no preguntarse por qué nadie contactó a alguien.
 */
export async function hiloDeConversacion(
  db: Db,
  tenantId: string,
  conversacionId: string,
): Promise<EntradaHilo[]> {
  const mensajes = await db.query<{
    id: string
    ocurrido_en: Date
    cuerpo: string
    direccion: 'entrante' | 'saliente'
    canal: Canal
    resultado: ResultadoEnvio
    motivo_bloqueo: string | null
  }>(
    `SELECT id, ocurrido_en, cuerpo, direccion, canal, resultado, motivo_bloqueo
       FROM contactos WHERE tenant_id = $1 AND conversacion_id = $2`,
    [tenantId, conversacionId],
  )

  const notas = await db.query<{
    id: string
    created_at: Date
    cuerpo: string
    usuario_id: string | null
  }>(
    `SELECT id, created_at, cuerpo, usuario_id
       FROM notas WHERE tenant_id = $1 AND conversacion_id = $2`,
    [tenantId, conversacionId],
  )

  const entradas: EntradaHilo[] = [
    ...mensajes.map((m) => ({
      tipo: 'mensaje' as const,
      id: m.id,
      ocurridoEn: new Date(m.ocurrido_en).toISOString(),
      cuerpo: m.cuerpo,
      direccion: m.direccion,
      canal: m.canal,
      resultado: m.resultado,
      motivoBloqueo: m.motivo_bloqueo,
    })),
    ...notas.map((n) => ({
      tipo: 'nota' as const,
      id: n.id,
      ocurridoEn: new Date(n.created_at).toISOString(),
      cuerpo: n.cuerpo,
      autorId: n.usuario_id,
    })),
  ]

  // Se ordena acá y no con un UNION en SQL: son dos tablas con forma distinta y
  // un UNION obligaría a rellenar columnas con NULL de un lado y del otro.
  return entradas.sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn))
}

export interface Expediente {
  conversacionId: string
  deudorNombre: string
  telefono: string | null
  documento: string
  numeroCredito: string
  saldoTotal: number
  diasMora: number
  tramo: string
  estadoObligacion: string
  fechaVencimiento: string
  contactable: boolean
  agentePausado: boolean
  motivoPausa: string | null
  asignadaA: string | null
  asignadaNombre: string | null
}

/** Todo lo que el panel derecho necesita, en una consulta. */
export async function expedienteDeConversacion(
  db: Db,
  tenantId: string,
  conversacionId: string,
): Promise<Expediente | null> {
  const filas = await db.query<Record<string, never>>(
    `SELECT c.id, d.nombre, d.telefonos, d.documento,
            d.consentimiento_otorgado, d.revocado_en,
            c.agente_pausado, c.motivo_pausa, c.asignada_a, u.nombre AS asignada_nombre,
            o.numero_credito, o.saldo_total_centavos, o.dias_mora, o.tramo,
            o.estado AS estado_obligacion, o.fecha_vencimiento
       FROM conversaciones c
       JOIN deudores d ON d.id = c.deudor_id AND d.tenant_id = c.tenant_id
       LEFT JOIN obligaciones o ON o.id = c.obligacion_id AND o.tenant_id = c.tenant_id
       LEFT JOIN tenant_usuarios u ON u.id = c.asignada_a AND u.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, conversacionId],
  )
  if (filas.length === 0) return null

  const f = filas[0] as unknown as {
    id: string; nombre: string; telefonos: string[]; documento: string
    consentimiento_otorgado: boolean; revocado_en: Date | null
    agente_pausado: boolean; motivo_pausa: string | null
    asignada_a: string | null; asignada_nombre: string | null
    numero_credito: string | null; saldo_total_centavos: string | null
    dias_mora: number | null; tramo: string | null
    estado_obligacion: string | null; fecha_vencimiento: Date | string | null
  }

  return {
    conversacionId: f.id,
    deudorNombre: f.nombre,
    telefono: f.telefonos[0] ?? null,
    documento: f.documento,
    numeroCredito: f.numero_credito ?? '—',
    saldoTotal: Math.round(Number(f.saldo_total_centavos ?? 0) / 100),
    diasMora: f.dias_mora ?? 0,
    tramo: f.tramo ?? '—',
    estadoObligacion: f.estado_obligacion ?? '—',
    fechaVencimiento: f.fecha_vencimiento
      ? String(f.fecha_vencimiento instanceof Date
          ? f.fecha_vencimiento.toISOString().slice(0, 10)
          : f.fecha_vencimiento).slice(0, 10)
      : '—',
    contactable: f.consentimiento_otorgado && f.revocado_en === null,
    agentePausado: f.agente_pausado,
    motivoPausa: f.motivo_pausa,
    asignadaA: f.asignada_a,
    asignadaNombre: f.asignada_nombre,
  }
}
