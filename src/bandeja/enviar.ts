import { crearProveedores } from '@/channels/factory'
import { interpolar } from '@/channels/provider'
import type { ChannelProvider } from '@/channels/provider'
import { registrarContacto } from '@/repo/cobranza/contactos'
import { expedienteDeConversacion, pausarAgente } from '@/repo/cobranza/conversaciones'
import { plantillasAprobadas, ventanaDe } from '@/repo/cobranza/ventanas'
import type { Db } from '@/repo/db'
import { decidirEnvioManual } from './envio-manual'

/**
 * Enviar a mano, sin depender de Next.
 *
 * Está separado de la acción de servidor para que se pueda probar: la acción
 * resuelve la sesión con `next/headers` y eso no corre fuera de un request. Acá
 * entra el `tenantId` ya resuelto y todo lo demás es código puro de aplicación.
 *
 * La separación no es solo por el test. La regla de la ventana de 24 h vive de
 * este lado, así que un camino nuevo que quiera mandar un mensaje —una acción,
 * una ruta, un job— la respeta por construcción en vez de tener que acordarse.
 */

export interface DatosEnvio {
  texto?: string
  plantillaId?: string
  variables?: string[]
}

export interface ResultadoEnvio {
  ok: boolean
  error?: string
  /** Lo que se cobró. Cero dentro de la ventana de 24 h. */
  costoCop?: number
}

export async function enviarManual(
  db: Db,
  params: {
    tenantId: string
    usuarioId: string
    conversacionId: string
    datos: DatosEnvio
    ahora?: Date
    /** Inyectable para probar sin red. Por defecto sale de la config del entorno. */
    proveedor?: ChannelProvider
  },
): Promise<ResultadoEnvio> {
  const ahora = params.ahora ?? new Date()

  const expediente = await expedienteDeConversacion(db, params.tenantId, params.conversacionId)
  if (!expediente) return { ok: false, error: 'No existe esa conversación.' }
  if (!expediente.telefono) return { ok: false, error: 'El deudor no tiene teléfono cargado.' }
  if (!expediente.contactable) {
    // El opt-out es del deudor y es de ley. No lo levanta un asesor con ganas.
    return { ok: false, error: 'Este deudor pidió la baja. No se le puede escribir.' }
  }

  const ventana = await ventanaDe(db, params.tenantId, expediente.deudorId)
  const plantilla = params.datos.plantillaId
    ? (await plantillasAprobadas(db, params.tenantId)).find((p) => p.id === params.datos.plantillaId)
    : null

  if (params.datos.plantillaId && !plantilla) {
    return { ok: false, error: 'Esa plantilla no existe o Meta todavía no la aprobó.' }
  }

  const decision = decidirEnvioManual({
    ventana,
    ahora,
    plantilla: plantilla
      ? {
          id: plantilla.id,
          nombreMeta: plantilla.nombreMeta,
          categoria: plantilla.categoria,
          aprobada: plantilla.aprobada,
          variables: plantilla.variables,
        }
      : null,
    texto: params.datos.texto ?? null,
    variables: params.datos.variables,
  })

  if (!decision.ok) return { ok: false, error: decision.detalle }

  const cuerpo = plantilla
    ? interpolar(plantilla.cuerpo, params.datos.variables ?? [])
    : (params.datos.texto ?? '')

  const proveedor = params.proveedor ?? crearProveedores().whatsapp
  const enviado = await proveedor.enviar({
    para: expediente.telefono,
    canal: 'whatsapp',
    plantilla: plantilla?.nombreMeta
      ? { nombre: plantilla.nombreMeta, variables: params.datos.variables ?? [] }
      : undefined,
    cuerpo,
    categoria: decision.categoria,
  })

  // Se registra el intento salga o no. Si falló, el asesor tiene que verlo en el
  // hilo, y el log de cumplimiento tiene que contarlo igual: un intento fallido
  // sigue siendo un intento.
  await registrarContacto(db, params.tenantId, {
    obligacionId: expediente.obligacionId,
    deudorId: expediente.deudorId,
    conversacionId: params.conversacionId,
    canal: 'whatsapp',
    direccion: 'saliente',
    timestamp: ahora.toISOString(),
    plantillaId: plantilla?.id ?? null,
    cuerpo,
    resultado: enviado.estado,
    motivoBloqueo: enviado.ok ? null : (enviado.error ?? 'fallo de envío'),
    costoCop: enviado.costoCop,
    // Lo que se cobró y con qué. Un envío bloqueado no llegó a salir, así que
    // tampoco se factura.
    categoria: enviado.estado === 'bloqueado' ? null : decision.categoria,
    idProveedor: enviado.idProveedor,
    proveedor: proveedor.nombre,
  })

  // Responder a mano pausa el agente. Nadie se acuerda de apretar el botón
  // antes de escribir, y dos voces en el mismo hilo es exactamente lo que el
  // cliente evita al dejar de cobrar desde los celulares de sus vendedores.
  await pausarAgente(db, params.tenantId, params.conversacionId, {
    usuarioId: params.usuarioId,
    motivo: 'Respondió un asesor',
  })

  return enviado.ok
    ? { ok: true, costoCop: enviado.costoCop }
    : { ok: false, error: enviado.error ?? 'No se pudo enviar.' }
}
