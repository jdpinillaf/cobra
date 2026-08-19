import { registrarContacto } from '@/repo/cobranza/contactos'
import {
  abrirOReutilizar,
  asignar,
  marcarLeida,
  pausarAgente,
} from '@/repo/cobranza/conversaciones'
import type { Db } from '@/repo/db'
import { generarHilos, type OpcionesHilos } from './seed-hilos'

/**
 * Persiste los hilos generados usando las mismas funciones del repositorio que
 * usa el código real.
 *
 * Es a propósito: si el seed escribiera SQL propio, produciría datos que el
 * repositorio nunca produciría, y la bandeja se construiría contra una realidad
 * que no existe. Además, sembrar ejercita `abrirOReutilizar`,
 * `registrarContacto` y `marcarLeida` de verdad — un seed que corre es un test
 * de humo gratis.
 */

export interface ResumenHilos {
  conversaciones: number
  mensajes: number
  notas: number
  etiquetas: number
}

const ETIQUETAS_TONO: Record<string, string> = {
  'promesa de pago': 'entregado',
  'en disputa': 'bloqueado',
  'no contesta': 'diferido',
  'número errado': 'bloqueado',
}

export async function sembrarHilos(
  db: Db,
  tenantId: string,
  opciones: OpcionesHilos,
): Promise<ResumenHilos> {
  const resumen: ResumenHilos = { conversaciones: 0, mensajes: 0, notas: 0, etiquetas: 0 }

  // Catálogo de etiquetas del tenant, una vez.
  const idPorEtiqueta = new Map<string, string>()
  for (const [nombre, tono] of Object.entries(ETIQUETAS_TONO)) {
    const [fila] = await db.query<{ id: string }>(
      `INSERT INTO etiquetas (tenant_id, nombre, tono) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, nombre) DO UPDATE SET tono = EXCLUDED.tono
       RETURNING id`,
      [tenantId, nombre, tono],
    )
    idPorEtiqueta.set(nombre, fila.id)
  }

  for (const hilo of generarHilos(opciones)) {
    const { id: conversacionId } = await abrirOReutilizar(db, tenantId, {
      deudorId: hilo.deudorId,
      obligacionId: hilo.obligacionId,
      ahora: hilo.mensajes[0]?.ocurridoEn ?? opciones.ahora,
    })
    resumen.conversaciones += 1

    for (const m of hilo.mensajes) {
      await registrarContacto(db, tenantId, {
        obligacionId: hilo.obligacionId,
        deudorId: hilo.deudorId,
        conversacionId,
        canal: 'whatsapp',
        direccion: m.direccion,
        timestamp: m.ocurridoEn,
        cuerpo: m.cuerpo,
        resultado: m.resultado,
        motivoBloqueo: m.motivoBloqueo,
        // Un saliente entregado cuesta lo de una plantilla utility; el entrante
        // y el bloqueado no cuestan nada.
        costoCop: m.direccion === 'saliente' && m.resultado !== 'bloqueado' ? 3.2 : 0,
        idProveedor: m.resultado === 'bloqueado' ? null : `wamid.seed.${resumen.mensajes}`,
        proveedor: m.resultado === 'bloqueado' ? null : 'meta',
      })
      resumen.mensajes += 1
    }

    for (const nota of hilo.notas) {
      await db.query(
        `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, conversacionId, nota.usuarioId, nota.cuerpo, nota.ocurridoEn],
      )
      resumen.notas += 1
    }

    for (const nombre of hilo.etiquetas) {
      const etiquetaId = idPorEtiqueta.get(nombre)
      if (!etiquetaId) continue
      await db.query(
        `INSERT INTO conversacion_etiquetas (tenant_id, conversacion_id, etiqueta_id)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tenantId, conversacionId, etiquetaId],
      )
      resumen.etiquetas += 1
    }

    if (hilo.agentePausado) {
      await pausarAgente(db, tenantId, conversacionId, {
        usuarioId: hilo.asignadaA,
        motivo: hilo.motivoPausa,
      })
    }
    if (hilo.asignadaA) {
      await asignar(db, tenantId, conversacionId, hilo.asignadaA)
    }

    // Marcar leído a quienes NO están en `sinLeerPara`.
    const ultimo = hilo.mensajes.at(-1)?.ocurridoEn
    if (ultimo) {
      for (const usuarioId of opciones.usuarios) {
        if (hilo.sinLeerPara.includes(usuarioId)) continue
        await marcarLeida(db, tenantId, conversacionId, usuarioId, ultimo)
      }
    }
  }

  return resumen
}
