import { TARIFA_META } from '@/channels/tarifas'
import { registrarContacto } from '@/repo/cobranza/contactos'
import {
  abrirOReutilizar,
  asignar,
  marcarLeida,
  pausarAgente,
} from '@/repo/cobranza/conversaciones'
import { renovarVentana } from '@/repo/cobranza/ventanas'
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
        // El costo sale del rate card real, no de una constante escrita a mano.
        // Antes acá había un `3.2` fijo para todo saliente entregado, que cobra
        // como `utility` los mensajes de la ventana de servicio — los que Meta
        // no cobra, y que son el grueso del tráfico de un agente conversacional.
        costoCop: m.categoria ? TARIFA_META.costoCop('whatsapp', m.categoria) : 0,
        categoria: m.categoria,
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

    const ultimoEntrante = hilo.mensajes.findLast((m) => m.direccion === 'entrante')

    // Lo que el arco dejó escrito sobre el **deudor**, no sobre el hilo.
    //
    // Sin esto el seed producía un estado imposible: un deudor que pidió la
    // baja en el mensaje que se ve en pantalla y que la cartera sigue dando por
    // contactable. La consola lo mostraba con el botón de enviar habilitado.
    //
    // Las dos columnas se escriben igual —el `IS NULL` conserva la fecha del
    // primer aviso, que es la que vale como evidencia— y lo único que cambia es
    // cuál. Dos UPDATE copiados era una copia que algún día pierde el `IS NULL`.
    //
    // El nombre de la columna se interpola, y es seguro: sale de un ternario
    // sobre una unión cerrada de dos literales, no de un dato. Los valores van
    // parametrizados como siempre.
    if (hilo.marca) {
      const columna = hilo.marca === 'opt-out' ? 'revocado_en' : 'numero_errado_en'
      await db.query(
        `UPDATE deudores SET ${columna} = $3
          WHERE tenant_id = $1 AND id = $2 AND ${columna} IS NULL`,
        [tenantId, hilo.deudorId, ultimoEntrante?.ocurridoEn ?? opciones.ahora],
      )
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

    // La ventana de 24 h nace del último entrante real, igual que en
    // producción. Así el seed produce hilos con ventana abierta y hilos con
    // ventana vencida, que son los dos estados que el redactor tiene que saber
    // dibujar. Sembrar solo ventanas abiertas escondería la mitad de la UI.
    if (ultimoEntrante) {
      await renovarVentana(db, tenantId, hilo.deudorId, ultimoEntrante.ocurridoEn)
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
