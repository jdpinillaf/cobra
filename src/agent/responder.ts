import { limitesDelTramo, pensar, type TurnoDelHilo } from './cerebro'
import { evaluarRespuesta } from './compuerta'
import { abrirPuerto } from './puerto-pg'
import { crearProveedores } from '@/channels/factory'
import type { ChannelProvider } from '@/channels/provider'
import { categoriaDelEnvio } from '@/channels/ventana-servicio'
import type { LimitesNegociacion } from '@/domain/types'
import { registrarContacto } from '@/repo/cobranza/contactos'
import { expedienteDeConversacion, hiloDeConversacion } from '@/repo/cobranza/conversaciones'
import { ventanaDe } from '@/repo/cobranza/ventanas'
import type { Db } from '@/repo/db'

/**
 * El agente contestando de verdad, sobre la base.
 *
 * Es el mismo pipeline que `src/demo/servicio.ts` corre en memoria para la
 * landing, con los mismos pasos y en el mismo orden, porque el orden importa:
 *
 *   1. El entrante ya está escrito. Lo hizo `procesarWebhook` antes de llamar
 *      acá, y la ventana de 24 h ya está abierta. Si el modelo falla, la prueba
 *      de que el deudor escribió existe igual.
 *   2. La compuerta decide si el agente habla. Un bloqueo legal deja un
 *      `Contacto` bloqueado —es la evidencia ante la SIC de que se intentó y la
 *      ley lo impidió— y una pausa no deja nada, porque no hubo intento de
 *      contacto sino una decisión operativa.
 *   3. Recién entonces piensa, y lo que responda sale por el proveedor.
 *
 * Lo que **no** hace es decidir si el mensaje merece respuesta por su contenido.
 * Eso es del cerebro.
 */

export type ResultadoRespuesta =
  | { respondio: true; texto: string; modo: 'llm' | 'guionado' }
  | { respondio: false; razon: 'sin_obligacion' | 'sin_telefono' | 'ley' | 'pausa' | 'error'; detalle: string }

export async function responderEntrante(
  db: Db,
  params: {
    tenantId: string
    conversacionId: string
    ahora?: Date
    urlBase: string
    proveedor?: ChannelProvider
  },
): Promise<ResultadoRespuesta> {
  const ahora = params.ahora ?? new Date()

  const expediente = await expedienteDeConversacion(db, params.tenantId, params.conversacionId)
  if (!expediente) return { respondio: false, razon: 'error', detalle: 'No existe esa conversación.' }
  if (!expediente.telefono) {
    return { respondio: false, razon: 'sin_telefono', detalle: 'El deudor no tiene teléfono.' }
  }

  const puerto = await abrirPuerto(db, params.tenantId, {
    conversacionId: params.conversacionId,
    obligacionId: expediente.obligacionId,
  })
  if (!puerto) {
    // Un deudor sin obligación abierta que escribe es un caso para una persona:
    // no hay nada que cobrar y el agente no tiene de qué hablar.
    return { respondio: false, razon: 'sin_obligacion', detalle: 'No hay obligación que gestionar.' }
  }

  const compuerta = evaluarRespuesta({
    ahora,
    deudor: puerto.deudor,
    obligacion: puerto.obligacion,
    contactosDelDeudor: puerto.contactosPrevios,
    // El asesor que toma el hilo calla al agente. Sin esto el bot contesta
    // encima de la persona, que es exactamente lo que la bandeja vino a evitar.
    modo: expediente.agentePausado ? 'humano' : 'agente',
  })

  if (!compuerta.responder) {
    if (compuerta.razon === 'ley') {
      // Un intento que la ley impidió se escribe. Es la evidencia documental, y
      // una pausa no: escribirla inventaría un intento de contacto que nunca
      // hubo y ensuciaría el reporte de cumplimiento con decisiones operativas.
      await registrarContacto(db, params.tenantId, {
        obligacionId: puerto.obligacion.id,
        deudorId: puerto.deudor.id,
        conversacionId: params.conversacionId,
        canal: 'whatsapp',
        direccion: 'saliente',
        timestamp: ahora.toISOString(),
        cuerpo: '',
        resultado: 'bloqueado',
        motivoBloqueo: `${compuerta.motivo}: ${compuerta.detalle}`,
        costoCop: 0,
      })
      return { respondio: false, razon: 'ley', detalle: compuerta.detalle }
    }
    return { respondio: false, razon: 'pausa', detalle: compuerta.detalle }
  }

  const [hilo, limites, cliente] = await Promise.all([
    hiloDeConversacion(db, params.tenantId, params.conversacionId),
    limitesDelTenant(db, params.tenantId, puerto.obligacion.tramo),
    nombreDelTenant(db, params.tenantId),
  ])

  // Las notas internas no entran: el deudor no las ve y meterlas en el contexto
  // le enseñaría al modelo cosas que el equipo escribió para sí mismo.
  const turnos: TurnoDelHilo[] = hilo
    .filter((e) => e.tipo === 'mensaje' && e.resultado !== 'bloqueado' && e.cuerpo.trim() !== '')
    .map((e) => ({ de: e.direccion === 'entrante' ? 'deudor' : 'agente', texto: e.cuerpo }))

  let respuesta: Awaited<ReturnType<typeof pensar>>
  try {
    respuesta = await pensar({ puerto, limites, turnos, cliente, urlBase: params.urlBase })
  } catch (error) {
    // `pensar` ya cae a guionado si falla el proveedor del modelo; esto cubre lo
    // que quede afuera. Un error acá no puede dejar al deudor esperando en
    // silencio ni al equipo sin saber por qué.
    const detalle = error instanceof Error ? error.message : String(error)
    await puerto.anotarPaso({
      herramienta: 'cerebro',
      detalle: `Falló al generar la respuesta: ${detalle}`,
      estado: 'bloqueado',
    })
    await puerto.tomaUnHumano()
    return { respondio: false, razon: 'error', detalle }
  }

  const ventana = await ventanaDe(db, params.tenantId, puerto.deudor.id)
  const categoria = categoriaDelEnvio({ ventana, ahora, categoriaDePlantilla: null })

  const proveedor = params.proveedor ?? crearProveedores().whatsapp
  const enviado = await proveedor.enviar({
    para: expediente.telefono,
    canal: 'whatsapp',
    cuerpo: respuesta.texto,
    categoria,
  })

  // Se registra salga o no: un intento fallido sigue siendo un intento, y el
  // asesor tiene que verlo en el hilo.
  await registrarContacto(db, params.tenantId, {
    obligacionId: puerto.obligacion.id,
    deudorId: puerto.deudor.id,
    conversacionId: params.conversacionId,
    canal: 'whatsapp',
    direccion: 'saliente',
    timestamp: ahora.toISOString(),
    cuerpo: respuesta.texto,
    resultado: enviado.estado,
    motivoBloqueo: enviado.ok ? null : (enviado.error ?? 'fallo de envío'),
    costoCop: enviado.costoCop,
    categoria: enviado.estado === 'bloqueado' ? null : categoria,
    idProveedor: enviado.idProveedor,
    proveedor: proveedor.nombre,
  })

  return { respondio: true, texto: respuesta.texto, modo: respuesta.modo }
}

/**
 * Lo que el cliente autorizó para ese tramo.
 *
 * `tenant_cobranza.limites_por_tramo` nace vacío, y vacío significa **no se
 * negocia nada**: sin descuento, una sola cuota, sin plazo. Un default
 * permisivo dejaría al agente ofreciendo condiciones que nadie firmó.
 */
async function limitesDelTenant(
  db: Db,
  tenantId: string,
  tramo: string,
): Promise<LimitesNegociacion> {
  const [fila] = await db.query<{ limites_por_tramo: Record<string, LimitesNegociacion> }>(
    `SELECT limites_por_tramo FROM tenant_cobranza WHERE tenant_id = $1`,
    [tenantId],
  )
  return limitesDelTramo(fila?.limites_por_tramo ?? {}, tramo)
}

async function nombreDelTenant(db: Db, tenantId: string): Promise<{ nombre: string }> {
  const [fila] = await db.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ])
  return { nombre: fila?.nombre ?? 'la empresa' }
}
