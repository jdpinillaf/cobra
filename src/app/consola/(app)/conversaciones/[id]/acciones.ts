'use server'

import { revalidatePath } from 'next/cache'
import { requerirSesion } from '@/auth/actual'
import { enviarManual } from '@/bandeja/enviar'
import { simularEntrante } from '@/bandeja/simular-entrante'
import { asignar, pausarAgente, reanudarAgente } from '@/repo/cobranza/conversaciones'
import { obtenerDb } from '@/repo/conexion'

/**
 * Acciones de la bandeja.
 *
 * Todas empiezan resolviendo la sesión y usan su `tenantId`, nunca uno que
 * venga del formulario. Un id de conversación en un request es un dato del
 * usuario y no una autorización: el `WHERE tenant_id = $1` de cada función del
 * repositorio es lo que impide que alguien opere sobre el hilo de otra empresa
 * mandando un uuid ajeno.
 */

export interface ResultadoAccion {
  ok: boolean
  error?: string
}

export async function accionPausar(conversacionId: string, motivo: string): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  await pausarAgente(db, sesion.tenantId, conversacionId, {
    usuarioId: sesion.usuarioId,
    motivo: motivo.trim() || null,
  })

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return { ok: true }
}

export async function accionReanudar(conversacionId: string): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  await reanudarAgente(db, sesion.tenantId, conversacionId)

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return { ok: true }
}

export async function accionTomar(conversacionId: string): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  await asignar(db, sesion.tenantId, conversacionId, sesion.usuarioId)

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return { ok: true }
}

export async function accionNota(conversacionId: string, cuerpo: string): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  if (cuerpo.trim() === '') return { ok: false, error: 'La nota está vacía.' }

  const db = await obtenerDb()
  await db.query(
    `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo) VALUES ($1,$2,$3,$4)`,
    [sesion.tenantId, conversacionId, sesion.usuarioId, cuerpo.trim()],
  )

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return { ok: true }
}

/**
 * Enviar a mano.
 *
 * Envoltura delgada: resuelve la sesión y delega. Toda la regla vive en
 * `enviarManual`, que se puede probar sin Next.
 */
export async function accionEnviar(
  conversacionId: string,
  datos: { texto?: string; plantillaId?: string; variables?: string[] },
): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  const r = await enviarManual(db, {
    tenantId: sesion.tenantId,
    usuarioId: sesion.usuarioId,
    conversacionId,
    datos,
  })

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/**
 * Escribir como si escribiera el deudor. Solo en modo demo.
 *
 * Envoltura delgada, igual que `accionEnviar`: la sesión y nada más. Las cuatro
 * cerraduras —pasar por `procesarWebhook`, tenant de la sesión, exigir
 * `modo_demo`, marcar la fila como `simulado`— viven en `simularEntrante`, que
 * se puede probar sin Next.
 */
export async function accionSimularEntrante(
  conversacionId: string,
  texto: string,
): Promise<ResultadoAccion> {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  const r = await simularEntrante(db, {
    tenantId: sesion.tenantId,
    conversacionId,
    texto,
  })

  revalidatePath(`/consola/conversaciones/${conversacionId}`)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
