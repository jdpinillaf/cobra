import { generateText, isStepCount, type ModelMessage } from 'ai'
import type { LimitesNegociacion } from '@/domain/types'
import { enBogota } from '@/compliance/reloj-bogota'
import {
  agregarPaso,
  deudorPorId,
  obligacionPorId,
  type Conversacion,
  type EstadoDemo,
} from '@/demo/estado'
import {
  crearHerramientas,
  emitirLinkDePago,
  registrarAcuerdo,
  type ContextoHerramientas,
} from './herramientas'
import { construirPrompt } from './prompt'
import { MARCADOR_LINK, responderGuionado } from './guionado'
import { modeloDelCerebro } from './modelo'

/**
 * El cerebro: lo que convierte un mensaje suelto en una decisión.
 *
 * Todo lo que necesita saber entra por herramientas, no por el prompt. Meter el
 * expediente completo en el system prompt sería más rápido y más barato, pero la
 * demo perdería lo único que la separa de un chatbot: poder mostrar *que*
 * consultó la cartera, y no solo el resultado.
 */

/** Techo de pasos por turno. Con ocho alcanza para consultar, validar, generar el link y responder. */
const PASOS_MAXIMOS = 8

export interface RespuestaCerebro {
  texto: string
  modo: 'llm' | 'guionado'
}

export async function pensar(params: {
  estado: EstadoDemo
  conversacion: Conversacion
  urlBase: string
}): Promise<RespuestaCerebro> {
  const { estado, conversacion, urlBase } = params

  const deudor = deudorPorId(estado, conversacion.deudorId)
  const obligacion = obligacionPorId(estado, conversacion.obligacionId)
  if (!deudor || !obligacion) {
    return { texto: 'No encuentro su información. Le paso el caso a un asesor.', modo: 'guionado' }
  }

  const limites = limitesDelTramo(estado, obligacion.tramo)
  const fechaHoy = enBogota(new Date()).fecha
  const ctx: ContextoHerramientas = { estado, conversacion, limites, fechaHoy, urlBase }

  const elegido = process.env.CEREBRO === 'guionado' ? null : modeloDelCerebro()
  if (!elegido) {
    return { texto: guion(ctx, deudor, obligacion), modo: 'guionado' }
  }

  try {
    const { text } = await generateText({
      model: elegido.modelo,
      system: construirPrompt({ cliente: estado.cartera.cliente, deudor, obligacion, limites, fechaHoy }),
      messages: aMensajesDelModelo(conversacion),
      tools: crearHerramientas(ctx),
      // Sin `temperature`: ni gpt-5 ni claude-sonnet-5 la aceptan, y el SDK
      // avisa por consola en cada turno. El tono se controla desde el prompt.
      stopWhen: isStepCount(PASOS_MAXIMOS),
    })

    const limpio = text.trim()
    // Un turno que termina sin texto (solo tool calls) dejaría al deudor sin
    // respuesta. Es raro, pero en vivo se vería como que el agente se colgó.
    if (!limpio) throw new Error('el modelo no devolvió texto')

    return { texto: limpio, modo: 'llm' }
  } catch (error) {
    // En vivo esto no puede propagarse: vale más una respuesta fija que un
    // mensaje de error en pantalla frente al cliente.
    console.error(`[cerebro] falló ${elegido.etiqueta}, cayendo a guionado:`, error)
    agregarPaso(estado, conversacion, {
      herramienta: 'cerebro',
      detalle: 'El modelo no respondió. Se usó la respuesta de respaldo.',
      estado: 'bloqueado',
    })
    return { texto: guion(ctx, deudor, obligacion), modo: 'guionado' }
  }
}

/**
 * El respaldo sin modelo.
 *
 * Ejecuta las acciones con las mismas funciones que usan las herramientas, así
 * que un acuerdo fuera de rango también se rechaza acá y el link que manda
 * existe de verdad. Es la diferencia entre una red de seguridad y un cartel que
 * dice "red de seguridad".
 */
function guion(
  ctx: ContextoHerramientas,
  deudor: NonNullable<ReturnType<typeof deudorPorId>>,
  obligacion: NonNullable<ReturnType<typeof obligacionPorId>>,
): string {
  const { conversacion, limites, fechaHoy } = ctx
  const ultimo = [...conversacion.mensajes].reverse().find((m) => m.de === 'deudor')

  const cuotaPactada = conversacion.acuerdo
    ? Math.round(conversacion.acuerdo.montoAcordado / conversacion.acuerdo.numeroCuotas)
    : null

  const { texto, accion } = responderGuionado(ultimo?.texto ?? '', {
    deudor,
    obligacion,
    limites,
    cuotaPactada,
  })

  switch (accion.tipo) {
    case 'acuerdo': {
      registrarAcuerdo(ctx, {
        tipo: 'cuotas',
        montoAcordado: accion.montoTotal,
        numeroCuotas: accion.numeroCuotas,
        descuentoPct: 0,
        primeraCuotaEl: fechaHoy,
      })
      return texto
    }
    case 'link': {
      const link = emitirLinkDePago(ctx, accion.montoCop)
      // Sin link no se manda el marcador crudo: mejor una frase sin URL que un
      // `{{link}}` en pantalla frente al cliente.
      return link
        ? texto.replace(MARCADOR_LINK, link.url)
        : texto.replace(MARCADOR_LINK, '').trimEnd().replace(/:$/, '.')
    }
    case 'escalar': {
      conversacion.estadoCaso = 'humano'
      conversacion.version += 1
      agregarPaso(ctx.estado, conversacion, {
        herramienta: 'escalarAHumano',
        detalle: 'Respaldo sin modelo: el caso pasa a una persona.',
        estado: 'ok',
      })
      return texto
    }
    default:
      return texto
  }
}

/**
 * El historial tal como lo ve el modelo.
 *
 * Los mensajes de un humano del equipo van como `assistant`: para el deudor son
 * la misma voz, y si fueran `user` el modelo creería que se los escribió él.
 */
function aMensajesDelModelo(conversacion: Conversacion): ModelMessage[] {
  return conversacion.mensajes
    .filter((m) => m.de !== 'sistema')
    .map((m): ModelMessage =>
      m.de === 'deudor'
        ? { role: 'user', content: m.texto }
        : { role: 'assistant', content: m.texto },
    )
}

/** Los límites del tramo, con un piso seguro si el cliente no configuró ese tramo. */
function limitesDelTramo(estado: EstadoDemo, tramo: string): LimitesNegociacion {
  const configurados = (
    estado.cartera.cliente.limitesPorTramo as Partial<Record<string, LimitesNegociacion>>
  )[tramo]
  // Sin configuración, no se negocia nada. Un default permisivo dejaría al
  // agente ofreciendo condiciones que nadie autorizó.
  return configurados ?? { descuentoMaxPct: 0, cuotasMax: 1, diasPlazoMax: 0, montoMinimoAbono: 0 }
}
