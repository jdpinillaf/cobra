/**
 * El briefing: qué pasó en las llamadas, leído de arriba.
 *
 * Una lista de seis llamadas no le dice nada a quien dirige la operación.
 * Lo que necesita saber es cuánto se acordó, qué objeción se repite, y a quién
 * hay que llamar de nuevo mañana. Eso es lo que arma esto.
 *
 * **Las cifras no las inventa el modelo.** Los totales —acuerdos, plata
 * comprometida, minutos, costo— se calculan en código y se le pasan hechos;
 * el modelo agrupa, nombra el patrón y prioriza. Un briefing con un número
 * alucinado es peor que no tener briefing.
 */
import { generateObject } from 'ai'
import { z } from 'zod'
import { modeloDelCerebro } from '@/agent/modelo'
import type { ResultadoLlamada } from './resumen'

export interface LlamadaParaBriefing {
  deudor: string
  resultado: ResultadoLlamada | null
  resumen: string | null
  duracionSeg: number | null
  costoCop: number
  /** Qué herramientas corrieron, para saber qué se ejecutó de verdad. */
  acciones: string[]
  /** Lo que dijo el deudor. Es de donde salen las objeciones. */
  dichoPorElDeudor: string[]
}

export const Briefing = z.object({
  titular: z.string().describe('Una frase que abra la reunión de la mañana, con la cifra que importa.'),
  loQueFuncionó: z.string().describe('Qué está cerrando. Dos frases.'),
  loQueSeRepite: z
    .array(z.object({
      objecion: z.string().describe('La objeción, en las palabras del deudor.'),
      cuantas: z.number().int().describe('En cuántas llamadas apareció.'),
      queHacer: z.string().describe('Qué cambiar para que deje de pasar. Una frase concreta.'),
    }))
    .max(4),
  aQuienLlamarPrimero: z
    .array(z.object({
      deudor: z.string(),
      porque: z.string().describe('Una frase. Por qué ese y no otro.'),
    }))
    .max(4),
  loQueHayQueArreglar: z
    .string()
    .describe('Lo que el agente hizo mal o dejó pasar. Si no hay nada, decirlo.'),
})
export type Briefing = z.infer<typeof Briefing>

export interface TotalesBriefing {
  llamadas: number
  conAcuerdo: number
  conLink: number
  escaladas: number
  bajas: number
  numerosErrados: number
  minutos: number
  costoCop: number
}

/** Los números, en código. El modelo no los toca. */
export function totalesDe(llamadas: LlamadaParaBriefing[]): TotalesBriefing {
  const cuantas = (r: ResultadoLlamada) => llamadas.filter((l) => l.resultado === r).length
  return {
    llamadas: llamadas.length,
    conAcuerdo: llamadas.filter((l) => l.acciones.includes('proponerAcuerdo')).length,
    conLink: cuantas('acuerdo'),
    escaladas: cuantas('escalado'),
    bajas: cuantas('baja'),
    numerosErrados: cuantas('numero_errado'),
    minutos: llamadas.reduce((t, l) => t + Math.ceil(Math.max(l.duracionSeg ?? 0, 0) / 60), 0),
    costoCop: llamadas.reduce((t, l) => t + l.costoCop, 0),
  }
}

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Math.round(n))

const SISTEMA = `Eres quien dirige la operación de cobranza de una empresa colombiana y le
resumes la jornada al dueño, que tiene tres minutos.

Reglas:
- **No inventes cifras.** Usa solo los totales que te doy.
- Agrupa: tres llamadas con la misma objeción son un patrón, no tres renglones.
- «Lo que hay que arreglar» es sobre **el agente**, no sobre los deudores: dónde no llamó a una
  herramienta, dónde repitió, dónde se le escapó algo. Si estuvo bien, dilo sin rellenar.
- Nombra a las personas por su nombre.
- Español colombiano, de usted, directo. Sin viñetas dentro de los campos.`

function comoTexto(llamadas: LlamadaParaBriefing[], t: TotalesBriefing): string {
  return [
    `Totales del periodo: ${t.llamadas} llamadas · ${t.conAcuerdo} con acuerdo propuesto · ` +
      `${t.conLink} cerraron con link · ${t.escaladas} escaladas · ${t.bajas} pidieron la baja · ` +
      `${t.numerosErrados} números errados · ${t.minutos} minutos · ${cop(t.costoCop)}.`,
    '',
    ...llamadas.map((l) =>
      [
        `— ${l.deudor} (${l.resultado ?? 'sin resultado'}, ${l.duracionSeg ?? 0}s)`,
        `  resumen: ${l.resumen ?? 'sin resumen'}`,
        `  ejecutó: ${l.acciones.join(', ') || 'nada'}`,
        `  dijo: ${l.dichoPorElDeudor.map((d) => `«${d}»`).join(' ') || '—'}`,
      ].join('\n'),
    ),
  ].join('\n')
}

/** Sin modelo no hay briefing, pero sí totales: la pantalla nunca queda muda. */
export function briefingSinModelo(t: TotalesBriefing): Briefing {
  return {
    titular: `${t.llamadas} llamadas, ${t.conLink} cerraron con link de pago.`,
    loQueFuncionó:
      t.conLink > 0
        ? `${t.conLink} de ${t.llamadas} terminaron con un acuerdo y su link enviado.`
        : 'Ninguna llamada llegó a enviar link de pago en este periodo.',
    loQueSeRepite: [],
    aQuienLlamarPrimero: [],
    loQueHayQueArreglar: 'Sin llave de modelo no se puede revisar el detalle de las llamadas.',
  }
}

export async function armarBriefing(
  llamadas: LlamadaParaBriefing[],
): Promise<{ briefing: Briefing; totales: TotalesBriefing }> {
  const totales = totalesDe(llamadas)
  const cerebro = modeloDelCerebro()
  if (!cerebro || llamadas.length === 0) {
    return { briefing: briefingSinModelo(totales), totales }
  }

  try {
    const { object } = await generateObject({
      model: cerebro.modelo,
      schema: Briefing,
      system: SISTEMA,
      prompt: comoTexto(llamadas, totales),
    })
    return { briefing: object, totales }
  } catch {
    return { briefing: briefingSinModelo(totales), totales }
  }
}
