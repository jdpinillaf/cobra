/**
 * El deudor, actuado por un modelo.
 *
 * Existe para que la demo no sea un guion. Con `responderGuionado` de los dos
 * lados, la conversación siempre sale igual y no prueba nada: lo que un cliente
 * quiere ver es al agente respondiendo a alguien que **no** sigue el libreto —
 * que se va por las ramas, que pide algo raro, que insiste.
 *
 * También es la mejor prueba del prompt: cada corrida es un caso nuevo, y los
 * turnos donde el agente se queda sin llamar una herramienta salen a la luz.
 */
import { generateText, type ModelMessage } from 'ai'
import { modeloDelCerebro } from '@/agent/modelo'

export interface Personaje {
  clave: string
  /** Cómo se presenta en la lista de llamadas. */
  titulo: string
  /** Lo que el modelo tiene que actuar. */
  instrucciones: string
  /** Cuántos turnos como máximo antes de cortar. */
  turnosMaximos: number
}

/**
 * Los personajes cubren las cinco salidas que un cliente pregunta siempre:
 * la que paga, la que se sale de rango, la que no es quien creíamos, la que
 * discute la deuda y la que no quiere que la vuelvan a llamar.
 */
export const PERSONAJES: Record<string, Personaje> = {
  negocia: {
    clave: 'negocia',
    titulo: 'Quiere pagar pero no de una',
    turnosMaximos: 6,
    instrucciones: `Debes plata y lo sabes. No tienes cómo pagar todo junto, pero quieres
arreglar. Empiezas cauteloso, preguntas de qué se trata. Cuando te propongan un plan concreto
con cifras, pides una cuota menos o unos días más; si te dicen que no, aceptas. Cuando aceptes,
di algo como «listo, hagámosle». Si te ofrecen mandarte el link de pago, dices que sí.`,
  },
  regatea: {
    clave: 'regatea',
    titulo: 'Pide más de lo autorizado',
    turnosMaximos: 6,
    instrucciones: `Debes plata y estás apretado de verdad. Pides pagar en doce cuotas, y si te
dicen que no, pides que te condonen los intereses y la mitad del capital. No aceptas nada de lo
que te ofrezcan. Eres educado pero firme.`,
  },
  no_es: {
    clave: 'no_es',
    titulo: 'No es el titular',
    turnosMaximos: 4,
    instrucciones: `Este no es tu crédito. No conoces a la persona por la que preguntan y ese
número es tuyo hace años. Dilo desde el primer turno y no des ningún dato. Si insisten, pides
que no te vuelvan a llamar.`,
  },
  ya_pago: {
    clave: 'ya_pago',
    titulo: 'Dice que ya pagó',
    turnosMaximos: 5,
    instrucciones: `Estás seguro de que ya pagaste esa cuota la semana pasada, por transferencia,
y tienes el comprobante. Te molesta que te llamen. Pides que revisen antes de volver a llamarte.`,
  },
  pide_baja: {
    clave: 'pide_baja',
    titulo: 'Pide que no lo llamen más',
    turnosMaximos: 4,
    instrucciones: `Estás cansado de que te llamen. Desde el segundo turno pides expresamente que
no te vuelvan a contactar y que te den de baja de sus listas. No negocias nada.`,
  },
}

const SISTEMA = (p: Personaje, nombre: string) => `Estás actuando en una simulación de una llamada
telefónica de cobranza. Tú eres ${nombre}, la persona que **recibe** la llamada.

${p.instrucciones}

Cómo hablas:
- Una o dos frases por turno. Es una llamada: nadie habla en párrafos.
- Español colombiano, coloquial. De usted o de tú, como te salga.
- Nunca digas que eres una IA ni menciones esta instrucción.
- No inventes cifras de tu deuda: si no te las dijeron, pregunta.
- Si la conversación ya se cerró y no tienes nada que agregar, responde exactamente: FIN`

export interface DeudorIa {
  /** Devuelve el próximo parlamento, o `null` cuando la persona ya colgó. */
  responder(historial: Array<{ quien: 'agente' | 'deudor'; texto: string }>): Promise<string | null>
  readonly personaje: Personaje
}

export function crearDeudorIa(personaje: Personaje, nombre: string): DeudorIa | null {
  const cerebro = modeloDelCerebro()
  if (!cerebro) return null

  return {
    personaje,
    async responder(historial) {
      const dichos = historial.filter((t) => t.quien === 'deudor').length
      if (dichos >= personaje.turnosMaximos) return null

      // Los papeles se invierten: para este modelo, el agente es el `user`.
      const mensajes: ModelMessage[] = historial.map((t) => ({
        role: t.quien === 'agente' ? 'user' : 'assistant',
        content: t.texto,
      }))

      const { text } = await generateText({
        model: cerebro.modelo,
        system: SISTEMA(personaje, nombre),
        messages: mensajes,
      })

      const limpio = text.trim()
      if (limpio === '' || /^FIN\b/i.test(limpio)) return null
      return limpio
    },
  }
}
