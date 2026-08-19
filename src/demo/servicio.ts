import type { Contacto } from '@/domain/types'
import { detectarOptOut } from '@/channels/opt-out'
import { tarifaDe } from '@/channels/provider'
import { abrirVentana, requierePlantilla } from '@/channels/ventana-servicio'
import { esAtribuibleAlAgente } from '@/payments/wompi'
import { evaluarRespuesta } from '@/agent/compuerta'
import { pensar } from '@/agent/cerebro'
import { espejarEnChatwoot } from '@/integrations/chatwoot'
import {
  abrirConversacion,
  agregarMensaje,
  agregarPaso,
  agregarPasoSiCambia,
  buscarPorTelefono,
  contactosDelDeudor,
  deudorPorId,
  estadoDemo,
  obligacionPorId,
  registrarContacto,
  telefonoProtagonista,
  type Conversacion,
  type EstadoDemo,
} from './estado'
import type { VistaConversacion } from './vista'

/**
 * Orquestación de la demo: lo que pasa entre que entra un mensaje y sale la
 * respuesta.
 *
 * Es la versión sin persistencia del cableado que le falta al motor. El orden de
 * los pasos es el mismo que documenta `procesador-webhook.ts:43-49` y no es
 * arbitrario: **primero se registra el entrante y se abre la ventana, después se
 * evalúa el opt-out**, para que el mensaje que pide la baja quede en el log como
 * evidencia de cuándo la pidió.
 */

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

export type { VistaConversacion } from './vista'

/**
 * Deja la conversación lista para la demo: con el recordatorio de la cadencia ya
 * enviado, como estaría en un piloto real cuando el deudor responde.
 */
export function prepararConversacion(estado: EstadoDemo, telefono: string): Conversacion | null {
  const encontrado = buscarPorTelefono(estado, telefono)
  if (!encontrado) return null

  const { deudor, obligacion } = encontrado
  const conversacion = abrirConversacion(estado, telefono, deudor.id, obligacion.id)
  if (conversacion.mensajes.length > 0) return conversacion

  const plantilla = estado.cartera.plantillas.find((p) => p.id === 'p_media')
  // El recordatorio invita a escribir pero **no** lleva link: el link nace de la
  // negociación, con el monto que se acuerde. Mandarlo antes obligaría al deudor
  // a pagar el total o nada, que es justo lo que no funciona en mora media.
  const cuerpo =
    `Hola ${deudor.nombre.split(' ')[0]}, tu crédito ${obligacion.numeroCredito} tiene ` +
    `${obligacion.diasMora} días de mora y un saldo de ${cop(obligacion.saldoTotal)}. ` +
    `Escríbenos y armamos un acuerdo a tu medida.`

  registrarContacto(estado, {
    clienteId: obligacion.clienteId,
    obligacionId: obligacion.id,
    deudorId: deudor.id,
    canal: 'whatsapp',
    direccion: 'saliente',
    timestamp: new Date(Date.now() - 90_000).toISOString(),
    plantillaId: plantilla?.id ?? null,
    cuerpo,
    resultado: 'entregado',
    motivoBloqueo: null,
    costoCop: tarifaDe('whatsapp').costoCop('whatsapp', plantilla?.categoria ?? 'utility'),
    idProveedor: 'wamid.demo.0',
    proveedor: 'meta',
  })

  agregarMensaje(estado, conversacion, {
    de: 'agente',
    texto: cuerpo,
    ts: new Date(Date.now() - 90_000).toISOString(),
  })
  conversacion.estadoCaso = 'contactado'

  return conversacion
}

export async function recibirMensaje(params: {
  telefono: string
  texto: string
  urlBase: string
}): Promise<VistaConversacion | null> {
  const estado = estadoDemo()
  const conversacion = prepararConversacion(estado, params.telefono)
  if (!conversacion) return null

  const deudor = deudorPorId(estado, conversacion.deudorId)
  const obligacion = obligacionPorId(estado, conversacion.obligacionId)
  if (!deudor || !obligacion) return null

  const ahora = new Date()

  // 1. El entrante entra al log antes que nada. Si el proceso se cayera acá, la
  //    prueba de que el deudor escribió ya existe.
  agregarMensaje(estado, conversacion, { de: 'deudor', texto: params.texto })
  registrarContacto(estado, {
    clienteId: obligacion.clienteId,
    obligacionId: obligacion.id,
    deudorId: deudor.id,
    canal: 'whatsapp',
    direccion: 'entrante',
    timestamp: ahora.toISOString(),
    plantillaId: null,
    cuerpo: params.texto,
    resultado: 'entregado',
    motivoBloqueo: null,
    costoCop: 0,
    idProveedor: `wamid.demo.${estado.secuencia}`,
    proveedor: 'meta',
  })

  // 2. El entrante abre 24 h de ventana de servicio: dentro de ellas se puede
  //    responder texto libre y Meta no cobra.
  const ventana = abrirVentana({
    clienteId: obligacion.clienteId,
    deudorId: deudor.id,
    entranteEn: ahora.toISOString(),
  })
  conversacion.ventanaAbiertaEn = ventana.abiertaEn
  agregarPasoSiCambia(estado, conversacion, {
    herramienta: 'ventanaServicio',
    detalle: requierePlantilla(ventana, ahora)
      ? 'Fuera de ventana: solo plantillas'
      : 'Ventana de 24 h abierta · texto libre sin costo',
    estado: 'ok',
  })

  // 3. Recién ahora se mira si pidió la baja.
  if (detectarOptOut(params.texto)) {
    deudor.consentimiento = { ...deudor.consentimiento, revocadoEn: ahora.toISOString() }
    conversacion.estadoCaso = 'humano'
    agregarPaso(estado, conversacion, {
      herramienta: 'optOut',
      detalle: 'Pidió la baja. Consentimiento revocado y cadencia detenida.',
      estado: 'bloqueado',
    })
    const despedida = 'Listo. No le volvemos a escribir. Gracias por avisarnos.'
    responder(estado, conversacion, despedida, obligacion.clienteId, obligacion.id, deudor.id, ahora)
    void espejarEnChatwoot(estado, conversacion)
    return vista(estado, conversacion)
  }

  // 4. Compuerta de compliance. Solo las prohibiciones absolutas callan al agente.
  const compuerta = evaluarRespuesta({
    ahora,
    deudor,
    obligacion,
    contactosDelDeudor: contactosDelDeudor(estado, deudor.id),
    // El bug que esto cierra: `estadoCaso` marcaba 'humano' desde el
    // escalamiento y desde `responderComoHumano`, pero nadie lo leía. Un asesor
    // tomaba la conversación y el bot le contestaba encima al deudor.
    modo: conversacion.estadoCaso === 'humano' ? 'humano' : 'agente',
  })

  if (!compuerta.responder) {
    // Dos razones distintas para callar, y se registran distinto a propósito.
    //
    // Un bloqueo legal es un intento de contacto que la Ley 2300 impidió: va al
    // log de auditoría como `Contacto` bloqueado, porque eso es exactamente lo
    // que se le muestra a la SIC ante un reclamo.
    //
    // Una pausa es que un asesor tomó la conversación. No hubo intento de
    // contacto, así que escribir un `Contacto` bloqueado inventaría evidencia y
    // ensuciaría el reporte de cumplimiento con decisiones operativas.
    if (compuerta.razon === 'ley') {
      agregarPaso(estado, conversacion, {
        herramienta: 'guardLey2300',
        detalle: `${compuerta.motivo.replace(/_/g, ' ')} — ${compuerta.detalle}`,
        estado: 'bloqueado',
      })
      registrarContacto(estado, {
        clienteId: obligacion.clienteId,
        obligacionId: obligacion.id,
        deudorId: deudor.id,
        canal: 'whatsapp',
        direccion: 'saliente',
        timestamp: ahora.toISOString(),
        plantillaId: null,
        cuerpo: '',
        resultado: 'bloqueado',
        motivoBloqueo: `${compuerta.motivo}: ${compuerta.detalle}`,
        costoCop: 0,
        idProveedor: null,
        proveedor: null,
      })
    } else {
      agregarPaso(estado, conversacion, {
        herramienta: 'agentePausado',
        detalle: compuerta.detalle,
        estado: 'bloqueado',
      })
    }

    conversacion.estadoCaso = 'humano'
    void espejarEnChatwoot(estado, conversacion)
    return vista(estado, conversacion)
  }

  agregarPasoSiCambia(estado, conversacion, {
    herramienta: 'guardLey2300',
    detalle: compuerta.nota,
    estado: 'ok',
  })

  // 5. El cerebro. Sus herramientas escriben sus propios pasos en la traza.
  if (conversacion.estadoCaso === 'contactado' || conversacion.estadoCaso === 'en_cola') {
    conversacion.estadoCaso = 'negociando'
  }
  const respuesta = await pensar({ estado, conversacion, urlBase: params.urlBase })

  responder(estado, conversacion, respuesta.texto, obligacion.clienteId, obligacion.id, deudor.id, new Date())
  void espejarEnChatwoot(estado, conversacion)
  return vista(estado, conversacion)
}

/** Escribe la respuesta del agente en la conversación y en el log de auditoría. */
function responder(
  estado: EstadoDemo,
  conversacion: Conversacion,
  texto: string,
  clienteId: string,
  obligacionId: string,
  deudorId: string,
  ahora: Date,
): void {
  agregarMensaje(estado, conversacion, { de: 'agente', texto })
  registrarContacto(estado, {
    clienteId,
    obligacionId,
    deudorId,
    canal: 'whatsapp',
    direccion: 'saliente',
    timestamp: ahora.toISOString(),
    plantillaId: null,
    cuerpo: texto,
    resultado: 'entregado',
    motivoBloqueo: null,
    // Dentro de la ventana de servicio y sin plantilla, Meta no cobra.
    costoCop: 0,
    idProveedor: `wamid.demo.${estado.secuencia}`,
    proveedor: 'meta',
  })
}

/**
 * Aplica un pago: cierra la obligación, detiene la cadencia y avisa al deudor.
 *
 * Es el paso que hoy no existe en el motor — `construirLinkDePago()` y
 * `interpretarEvento()` están escritos pero nadie los conecta. Acá está el
 * cable, contra la pasarela simulada de la demo.
 */
export function aplicarPago(referencia: string): { ok: boolean; motivo?: string } {
  const estado = estadoDemo()
  const pago = estado.pagos.get(referencia)
  if (!pago) return { ok: false, motivo: 'Referencia desconocida.' }
  if (pago.estado === 'aprobado') return { ok: true }

  const obligacion = obligacionPorId(estado, pago.obligacionId)
  if (!obligacion) return { ok: false, motivo: 'La referencia no apunta a ninguna obligación.' }

  const pagadoEn = new Date().toISOString()
  const salientes = estado.contactos.filter(
    (c) => c.deudorId === obligacion.deudorId && c.direccion === 'saliente' && c.resultado !== 'bloqueado',
  )

  pago.estado = 'aprobado'
  pago.pagadoEn = pagadoEn
  pago.transaccionId = `trx_demo_${estado.secuencia + 1}`
  pago.atribuidoAlAgente = esAtribuibleAlAgente(pagadoEn, salientes.at(-1)?.timestamp ?? null)

  const saldoNuevo = Math.max(0, obligacion.saldoTotal - pago.monto)
  obligacion.saldoTotal = saldoNuevo
  obligacion.estado = saldoNuevo === 0 ? 'pagada' : 'acuerdo_vigente'

  const conversacion = [...estado.conversaciones.values()].find(
    (c) => c.obligacionId === obligacion.id,
  )
  if (!conversacion) return { ok: true }

  conversacion.pago = pago
  conversacion.estadoCaso = saldoNuevo === 0 ? 'pagado' : 'acuerdo'
  agregarPaso(estado, conversacion, {
    herramienta: 'conciliarPago',
    detalle:
      `Referencia ${referencia} → crédito ${obligacion.numeroCredito}. ` +
      `Saldo ${cop(saldoNuevo)}. Cadencia detenida.` +
      (pago.atribuidoAlAgente ? ' Atribuido al agente.' : ''),
    estado: 'ok',
  })

  const confirmacion =
    saldoNuevo === 0
      ? `Recibido, quedó a paz y salvo con el crédito ${obligacion.numeroCredito}. Gracias.`
      : `Recibido su pago de ${cop(pago.monto)}. Le queda ${cop(saldoNuevo)} según lo acordado.`
  responder(
    estado,
    conversacion,
    confirmacion,
    obligacion.clienteId,
    obligacion.id,
    obligacion.deudorId,
    new Date(),
  )
  void espejarEnChatwoot(estado, conversacion)

  return { ok: true }
}

/** Inyecta la respuesta de una persona del equipo (llega desde Chatwoot). */
export function responderComoHumano(params: {
  telefono: string
  texto: string
  autor: string
}): VistaConversacion | null {
  const estado = estadoDemo()
  const conversacion = estado.conversaciones.get(params.telefono)
  if (!conversacion) return null

  agregarMensaje(estado, conversacion, {
    de: 'humano',
    texto: params.texto,
    autor: params.autor,
  })
  conversacion.estadoCaso = 'humano'
  agregarPaso(estado, conversacion, {
    herramienta: 'relevoHumano',
    detalle: `${params.autor} tomó la conversación desde la consola.`,
    estado: 'ok',
  })
  return vista(estado, conversacion)
}

export function vistaPorTelefono(telefono?: string): VistaConversacion | null {
  const estado = estadoDemo()
  const numero = telefono ?? telefonoProtagonista()
  const conversacion = prepararConversacion(estado, numero)
  return conversacion ? vista(estado, conversacion) : null
}

function vista(estado: EstadoDemo, conversacion: Conversacion): VistaConversacion | null {
  const deudor = deudorPorId(estado, conversacion.deudorId)
  const obligacion = obligacionPorId(estado, conversacion.obligacionId)
  if (!deudor || !obligacion) return null

  const limites = estado.cartera.cliente.limitesPorTramo[obligacion.tramo] ?? {
    descuentoMaxPct: 0,
    cuotasMax: 1,
    diasPlazoMax: 0,
    montoMinimoAbono: 0,
  }

  const previos: Contacto[] = contactosDelDeudor(estado, deudor.id)

  return {
    telefono: conversacion.telefono,
    version: conversacion.version,
    estadoCaso: conversacion.estadoCaso,
    mensajes: conversacion.mensajes,
    traza: conversacion.traza,
    expediente: {
      nombre: deudor.nombre,
      documento: deudor.documento,
      numeroCredito: obligacion.numeroCredito,
      saldoTotal: obligacion.saldoTotal,
      saldoLegible: cop(obligacion.saldoTotal),
      capital: obligacion.capital,
      interesMora: obligacion.interesMora,
      diasMora: obligacion.diasMora,
      tramo: obligacion.tramo,
      estadoObligacion: obligacion.estado,
      fechaVencimiento: obligacion.fechaVencimiento,
      consentimiento: {
        otorgado: deudor.consentimiento.otorgado,
        fuente: deudor.consentimiento.fuente,
        revocadoEn: deudor.consentimiento.revocadoEn,
      },
      contactosPrevios: previos.filter((c) => c.direccion === 'saliente').length,
    },
    limites,
    acuerdo: conversacion.acuerdo,
    pago: conversacion.pago,
    auditoria: previos.length,
  }
}
