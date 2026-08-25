/**
 * El agente que revisa el descuadre.
 *
 * **No decide nada.** El cruce ya dijo qué no coincide, con números exactos y
 * de forma determinística; esto solo traduce a español lo que pasó y propone
 * por dónde empezar. Es la diferencia entre una pantalla que muestra 47 filas
 * rojas y una que dice «hay un pago que el banco recibió y el contable nunca
 * aplicó: son 3,2 millones y es lo primero que hay que mirar».
 *
 * Si no hay llave, hay un resumen determinista. Una pantalla sin explicación es
 * peor que una explicación sin modelo.
 */
import { generateObject } from 'ai'
import { z } from 'zod'
import { modeloDelCerebro } from '@/agent/modelo'
import type { ResultadoMultiple } from './cruce'

export const Hallazgo = z.object({
  titulo: z.string().describe('Una frase. Qué pasó, en el idioma del cliente.'),
  explicacion: z.string().describe('Dos frases como máximo: qué lo explica y qué revisar.'),
  referencias: z.array(z.string()).describe('Las referencias afectadas. Máximo cinco.'),
  montoCop: z.number().describe('Cuántos pesos involucra este hallazgo.'),
  gravedad: z.enum(['alta', 'media', 'baja']),
})
export type Hallazgo = z.infer<typeof Hallazgo>

export const Veredicto = z.object({
  titular: z.string().describe('Una frase para abrir la reunión, con la cifra que importa.'),
  hallazgos: z.array(Hallazgo).max(6),
  porDondeEmpezar: z.string().describe('La primera acción concreta. Una frase.'),
})
export type Veredicto = z.infer<typeof Veredicto>

const pesos = (centavos: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Math.round(centavos / 100))

/**
 * Lo que el modelo ve.
 *
 * Solo las filas que **no** cuadran, y como máximo 60: mandarle las mil que
 * cuadran gasta tokens en confirmar lo obvio y diluye lo que importa. Los
 * montos van ya formateados para que no tenga que dividir por cien —una cuenta
 * que un modelo hace mal más seguido de lo que uno esperaría—.
 */
function comoTexto(r: ResultadoMultiple): string {
  const nombres = Object.fromEntries(r.fuentes.map((f) => [f.clave, f.nombre]))
  const lineas = r.filas
    .filter((f) => f.estado !== 'cuadra')
    .slice(0, 60)
    .map((f) => {
      const montos = Object.entries(f.porFuente)
        .map(([k, v]) => `${nombres[k] ?? k}=${v === null ? 'NO ESTÁ' : pesos(v)}`)
        .join(' · ')
      const desvia = f.sospechosa ? ` · se desvía: ${nombres[f.sospechosa] ?? f.sospechosa}` : ''
      return `${f.claveOriginal}: ${montos}${desvia}`
    })

  return [
    `Fuentes: ${r.fuentes.map((f) => `${f.nombre} (${f.filas} filas, total ${pesos(f.totalCentavos)})`).join(' · ')}`,
    `Descuadres: ${r.resumen.falta_en_alguna} referencias faltan en alguna fuente, ${r.resumen.monto_distinto} tienen montos distintos, ${r.resumen.cuadra} cuadran.`,
    `Valor en riesgo: ${pesos(r.valorEnRiesgoCentavos)}.`,
    r.ilegibles.length > 0 ? `Filas ilegibles: ${r.ilegibles.length}.` : '',
    '',
    ...lineas,
  ]
    .filter(Boolean)
    .join('\n')
}

const SISTEMA = `Eres el analista de conciliación de una empresa colombiana. Te dan el
resultado de cruzar varias fuentes del mismo dinero —el software contable, el portal del banco,
el Excel de la operación— y tu trabajo es decir **qué pasó**, no repetir los números.

Reglas:
- Agrupa: cinco filas con el mismo síntoma son un solo hallazgo, no cinco.
- Nombra la causa probable cuando el patrón la sugiera (un IVA que se sumó de más, un abono
  parcial, un cobro por fuera del sistema, una factura que no se pasó al Excel).
- **No inventes cifras.** Usa solo las que te dieron.
- Si una fuente se desvía de las otras dos, dilo: esa es la que hay que corregir.
- Ordena por plata, no por cantidad de filas.
- Español colombiano, de usted, directo. Sin viñetas dentro de los campos.`

/** Veredicto sin modelo: menos rico, pero nunca deja la pantalla muda. */
export function veredictoSinModelo(r: ResultadoMultiple): Veredicto {
  const faltan = r.filas.filter((f) => f.estado === 'falta_en_alguna')
  const difieren = r.filas.filter((f) => f.estado === 'monto_distinto')

  const hallazgos: Hallazgo[] = []
  if (faltan.length > 0) {
    hallazgos.push({
      titulo: `${faltan.length} referencias no están en todas las fuentes`,
      explicacion:
        'Cada una está en al menos un origen y falta en otro. Es lo que hay que revisar primero: un registro que solo existe de un lado no lo cuadra nadie.',
      referencias: faltan.slice(0, 5).map((f) => f.claveOriginal),
      montoCop: Math.round(
        faltan.reduce((t, f) => t + Math.max(...Object.values(f.porFuente).map((v) => v ?? 0)), 0) / 100,
      ),
      gravedad: 'alta',
    })
  }
  if (difieren.length > 0) {
    hallazgos.push({
      titulo: `${difieren.length} referencias con montos distintos`,
      explicacion:
        'Están en todas las fuentes, pero con cifras que no coinciden. Cuando dos coinciden y una se sale, la que se sale es la que hay que corregir.',
      referencias: difieren.slice(0, 5).map((f) => f.claveOriginal),
      montoCop: Math.round(difieren.reduce((t, f) => t + f.dispersionCentavos, 0) / 100),
      gravedad: 'media',
    })
  }

  return {
    titular: `${pesos(r.valorEnRiesgoCentavos)} en juego entre ${r.fuentes.length} fuentes.`,
    hallazgos,
    porDondeEmpezar:
      hallazgos.length === 0
        ? 'No hay descuadres: las fuentes coinciden.'
        : 'Empiece por las referencias que faltan en alguna fuente, ordenadas por monto.',
  }
}

export async function verificar(r: ResultadoMultiple): Promise<Veredicto> {
  const cerebro = modeloDelCerebro()
  if (!cerebro) return veredictoSinModelo(r)

  try {
    const { object } = await generateObject({
      model: cerebro.modelo,
      schema: Veredicto,
      system: SISTEMA,
      prompt: comoTexto(r),
    })
    return object
  } catch {
    // Un modelo caído no puede dejar la pantalla sin explicación.
    return veredictoSinModelo(r)
  }
}
