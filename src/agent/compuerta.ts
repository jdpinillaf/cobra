import type { Contacto, Deudor, Obligacion } from '@/domain/types'
import { evaluar, type Decision, type MotivoBloqueo } from '@/compliance/guard'

/**
 * ¿Puede el agente responderle a alguien que acaba de escribir?
 *
 * No es la misma pregunta que resuelve el guard. La Ley 2300 limita **cuándo la
 * empresa contacta al deudor**: horario, domingos, festivos, cuántas veces por
 * semana. Responder un mensaje que el deudor mandó es otra cosa — si escribe un
 * domingo a las nueve de la noche preguntando cómo paga, dejarlo sin respuesta
 * no protege a nadie.
 *
 * Lo que sí sigue mandando son las prohibiciones absolutas: pidió la baja, no
 * autorizó, no es el titular, o la obligación ya está cerrada. Esas no las
 * levanta ningún mensaje entrante.
 *
 * Se evalúa el guard completo igual, aunque no bloquee, porque su decisión es lo
 * que se muestra en el panel y lo que queda en el log de auditoría.
 *
 * La otra razón para callar es operativa y no legal: un asesor tomó la
 * conversación. Va por una rama aparte a propósito. Si la pausa entrara al enum
 * de motivos del guard, un reporte de cumplimiento diría que la Ley 2300
 * bloqueó un contacto que en realidad frenó una persona, y ese reporte es
 * justamente la evidencia que se le muestra a la SIC.
 */

const ABSOLUTOS = new Set<MotivoBloqueo>([
  'destinatario_es_referencia',
  'opt_out',
  // Quien escribió no es el deudor. Que haya escrito recién es justamente el
  // motivo para callarse: contestarle es seguir gestionando una cartera contra
  // un tercero.
  'numero_no_corresponde',
  'sin_consentimiento',
  'obligacion_cerrada',
])

/** Quién está a cargo de la conversación. Sin esto, el agente contesta encima del asesor. */
export type ModoConversacion = 'agente' | 'humano'

export type Compuerta =
  | { responder: true; decision: Decision; nota: string }
  | { responder: false; razon: 'ley'; motivo: MotivoBloqueo; detalle: string; decision: Decision }
  | { responder: false; razon: 'pausa'; detalle: string; decision: Decision }

export function evaluarRespuesta(params: {
  ahora: Date
  deudor: Deudor
  obligacion: Obligacion
  contactosDelDeudor: Contacto[]
  /** Por defecto `agente`, para no romper a quien todavía no lo pasa. */
  modo?: ModoConversacion
}): Compuerta {
  const decision = evaluar({
    ahora: params.ahora,
    canal: 'whatsapp',
    deudor: params.deudor,
    obligacion: params.obligacion,
    contactosDelDeudor: params.contactosDelDeudor,
  })

  // Orden deliberado. Los dos primeros frenan al agente, pero solo uno es una
  // obligación de ley, y ese es el que tiene que quedar escrito en la evidencia.
  if (!decision.permitido && ABSOLUTOS.has(decision.motivo)) {
    return {
      responder: false,
      razon: 'ley',
      motivo: decision.motivo,
      detalle: decision.detalle,
      decision,
    }
  }

  if (params.modo === 'humano') {
    return {
      responder: false,
      razon: 'pausa',
      detalle: 'Un asesor tiene la conversación. El agente no responde hasta que se reanude.',
      decision,
    }
  }

  if (decision.permitido) {
    return { responder: true, decision, nota: 'Dentro de la ventana legal de contacto.' }
  }

  return {
    responder: true,
    decision,
    nota: `El guard habría bloqueado un envío propio (${decision.motivo.replace(/_/g, ' ')}), pero esto es una respuesta a un mensaje del deudor: la ley limita cuándo contactamos, no cuándo respondemos.`,
  }
}
