import type { Contacto } from '@/domain/types'
import { detectarOptOut } from '@/channels/opt-out'
import { tarifaDe } from '@/channels/provider'
import { abrirVentana, requierePlantilla } from '@/channels/ventana-servicio'
import { esAtribuibleAlAgente } from '@/payments/wompi'
import { evaluarRespuesta } from '@/agent/compuerta'
import { limitesDelTramo, pensar } from '@/agent/cerebro'
import { PuertoEnMemoria } from '@/agent/puerto'
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
    // La fecha en que el deudor pidió la baja es evidencia ante la SIC, y es la
    // primera vez que lo pidió. Cada mensaje posterior la reescribía hacia
    // adelante y borraba el dato que importa.
    const yaEstaba = deudor.consentimiento.revocadoEn !== null
    if (!yaEstaba) {
      deudor.consentimiento = { ...deudor.consentimiento, revocadoEn: ahora.toISOString() }
    }
    agregarPaso(estado, conversacion, {
      herramienta: 'optOut',
      detalle: yaEstaba
        ? 'Volvió a pedir la baja. Ya estaba revocado, no se repite la despedida.'
        : 'Pidió la baja. Consentimiento revocado y cadencia detenida.',
      estado: 'bloqueado',
    })
    // Se confirma una sola vez, y antes de marcar el caso como humano: si no, la
    // pausa que el propio opt-out crea bloquearía su confirmación. Repetir "no
    // le volvemos a escribir" en cada mensaje es exactamente lo que el deudor
    // pidió que dejara de pasar.
    if (!yaEstaba) {
      const despedida = 'Listo. No le volvemos a escribir. Gracias por avisarnos.'
      responder(estado, conversacion, despedida, obligacion.clienteId, obligacion.id, deudor.id, ahora, {
        reconocimientoDeBaja: true,
      })
    }
    conversacion.estadoCaso = 'humano'
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
      // Si el deudor escribe cinco veces con el agente pausado, la traza lo dice
      // una vez. Repetirlo esconde lo que sí pasó entre medio.
      agregarPasoSiCambia(estado, conversacion, {
        herramienta: 'agentePausado',
        detalle: compuerta.detalle,
        estado: 'bloqueado',
      })
    }

    // Solo la pausa marca el caso como humano.
    //
    // Antes esto corría también en la rama legal, y un bloqueo transitorio
    // dejaba el hilo pausado para siempre: `sin_consentimiento` lo marcaba
    // 'humano', el deudor después autorizaba, la ley ya no bloqueaba, y la
    // compuerta seguía respondiendo "un asesor tiene la conversación" sin que
    // ningún asesor la hubiera tocado. Es la misma mezcla que el enum evita,
    // ocurriendo una capa más arriba.
    if (compuerta.razon === 'pausa') conversacion.estadoCaso = 'humano'
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
  // El entrante y la ventana ya están escritos. Si el modelo falla acá y la
  // excepción sube, el deudor se queda sin respuesta y la traza sin registro de
  // por qué. `pensar` ya cae a guionado ante un error del proveedor; esto cubre
  // lo que quede afuera, que es el caso en que ni el fallback funciona.
  let respuesta: Awaited<ReturnType<typeof pensar>>
  try {
    respuesta = await pensar({
      puerto: new PuertoEnMemoria(estado, conversacion, deudor, obligacion),
      limites: limitesDelTramo(estado.cartera.cliente.limitesPorTramo, obligacion.tramo),
      turnos: conversacion.mensajes
        .filter((m) => m.de !== 'sistema')
        .map((m) => ({ de: m.de as 'deudor' | 'agente', texto: m.texto })),
      cliente: estado.cartera.cliente,
      urlBase: params.urlBase,
    })
  } catch (error) {
    agregarPaso(estado, conversacion, {
      herramienta: 'cerebro',
      detalle: `Falló al generar la respuesta: ${error instanceof Error ? error.message : String(error)}`,
      estado: 'bloqueado',
    })
    conversacion.estadoCaso = 'humano'
    void espejarEnChatwoot(estado, conversacion)
    return vista(estado, conversacion)
  }

  responder(estado, conversacion, respuesta.texto, obligacion.clienteId, obligacion.id, deudor.id, new Date(), {
    autorizadoPorCompuerta: true,
  })
  void espejarEnChatwoot(estado, conversacion)
  return vista(estado, conversacion)
}

/**
 * ¿Puede el sistema escribirle al deudor ahora mismo?
 *
 * Existe porque había tres caminos que le escribían y solo uno consultaba la
 * compuerta: la despedida del opt-out salía antes de evaluarla, y la
 * confirmación de pago no la evaluaba nunca. No eran tres bugs sueltos, era un
 * punto de estrangulamiento que faltaba.
 *
 * Se consulta dentro de `responder`, que es el único lugar del módulo que
 * escribe un mensaje saliente. Ponerlo en cada llamador sería volver a confiar
 * en que nadie se olvide.
 */
function puedeEscribirle(
  estado: EstadoDemo,
  conversacion: Conversacion,
  deudorId: string,
): { puede: true } | { puede: false; motivo: string } {
  if (conversacion.estadoCaso === 'humano') {
    return { puede: false, motivo: 'agente_pausado' }
  }
  const deudor = estado.cartera.deudores.find((d) => d.id === deudorId)
  if (deudor?.consentimiento.revocadoEn) {
    return { puede: false, motivo: 'opt_out' }
  }
  return { puede: true }
}

/**
 * Escribe la respuesta del agente en la conversación y en el log de auditoría.
 *
 * Dos excepciones, las dos angostas.
 *
 * `autorizadoPorCompuerta` es para el turno normal: la compuerta ya corrió al
 * principio del turno y aprobó. La pausa impide que el agente **empiece** a
 * contestar, no que termine la respuesta que ya decidió dar — si el agente
 * resuelve escalar, el mensaje de "te paso con una persona" tiene que salir,
 * aunque escalar sea justamente lo que marca el caso como humano.
 *
 * `reconocimientoDeBaja` es para la confirmación de "no le volvemos a
 * escribir": es la respuesta al pedido del deudor, así que no puede quedar
 * bloqueada por el pedido mismo.
 *
 * Todo lo demás pasa por el chequeo. Esa es la garantía: un camino nuevo que
 * escriba sin pedir permiso queda bloqueado por defecto, no habilitado.
 */
function responder(
  estado: EstadoDemo,
  conversacion: Conversacion,
  texto: string,
  clienteId: string,
  obligacionId: string,
  deudorId: string,
  ahora: Date,
  opciones: { reconocimientoDeBaja?: boolean; autorizadoPorCompuerta?: boolean } = {},
): void {
  if (!opciones.autorizadoPorCompuerta) {
    const permiso = puedeEscribirle(estado, conversacion, deudorId)
    const exento =
      opciones.reconocimientoDeBaja === true && !permiso.puede && permiso.motivo === 'opt_out'

    if (!permiso.puede && !exento) {
      // `agregarPasoSiCambia` y no `agregarPaso`: si el deudor escribe cinco
      // veces con el agente pausado, la traza tiene que decirlo una vez, no
      // cinco. Una traza repetida esconde lo que sí pasó entre medio.
      agregarPasoSiCambia(estado, conversacion, {
        herramienta: permiso.motivo === 'agente_pausado' ? 'agentePausado' : 'optOut',
        detalle: 'Se descartó un mensaje saliente antes de enviarlo.',
        estado: 'bloqueado',
      })
      return
    }
  }

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

  // El permiso se evalúa acá, antes de que `estadoCaso` pase a 'pagado'.
  //
  // En la demo `estadoCaso` hace de dos cosas a la vez: en qué va el caso y
  // quién lo está manejando. Al marcarlo 'pagado' se pierde el dato de que un
  // asesor tenía el hilo, y el aviso salía encima de él. En el esquema real son
  // dos columnas distintas (`estado` y `agente_pausado`) justamente por esto.
  const permisoPrevio = puedeEscribirle(estado, conversacion, obligacion.deudorId)

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

  if (!permisoPrevio.puede) {
    agregarPasoSiCambia(estado, conversacion, {
      herramienta: permisoPrevio.motivo === 'agente_pausado' ? 'agentePausado' : 'optOut',
      detalle: 'Pago aplicado. No se le avisa al deudor por este canal.',
      estado: 'bloqueado',
    })
    void espejarEnChatwoot(estado, conversacion)
    return { ok: true }
  }

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
