import type { Deudor, LimitesNegociacion, Obligacion } from '@/domain/types'

/**
 * Respuestas fijas, sin modelo.
 *
 * Es la red de seguridad de la demo: si la API está lenta, sin crédito o caída
 * en mitad de la reunión, el agente sigue contestando algo coherente. Se activa
 * con `CEREBRO=guionado` o automáticamente cuando el modelo falla.
 *
 * **Devuelve una acción, no solo texto.** Un respaldo que dijera "ya le genero
 * el link" sin generarlo dejaría la demo rota justo en el paso que importa —
 * que es exactamente cuando el respaldo está corriendo. Las acciones las
 * ejecuta `cerebro.ts` con las mismas funciones que usan las herramientas del
 * modelo, así que pasan por las mismas validaciones.
 *
 * Cubre solo las rutas del guion de venta. Fuera de ahí responde con una salida
 * neutra — que es lo que hay que hacer cuando no se entiende: no improvisar.
 */

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

/** Marcador que `cerebro.ts` reemplaza por la URL del cobro. */
export const MARCADOR_LINK = '{{link}}'

export type AccionGuionada =
  | { tipo: 'ninguna' }
  | { tipo: 'acuerdo'; numeroCuotas: number; montoTotal: number }
  | { tipo: 'link'; montoCop: number }
  | { tipo: 'escalar' }

export interface RespuestaGuionada {
  /** Puede contener `MARCADOR_LINK`. */
  texto: string
  accion: AccionGuionada
}

interface Contexto {
  deudor: Deudor
  obligacion: Obligacion
  limites: LimitesNegociacion
  /** Si ya hay un acuerdo, cuánto va la primera cuota. */
  cuotaPactada: number | null
}

export function responderGuionado(texto: string, ctx: Contexto): RespuestaGuionada {
  const t = normalizar(texto)
  const nombre = ctx.deudor.nombre.split(' ')[0]
  const { obligacion, limites } = ctx

  // Dos cuotas es lo que ofrece el guion: cabe en todos los tramos que negocian
  // y parte el saldo en algo que se puede pagar hoy.
  const cuotas = Math.min(2, Math.max(1, limites.cuotasMax))
  const porCuota = Math.round(obligacion.saldoTotal / cuotas)

  if (contiene(t, ['no soy', 'numero equivocado', 'no conozco', 'se equivoco', 'esta equivocado'])) {
    return {
      texto: 'Le ofrezco disculpas por la molestia. Marco este número para no volver a escribirle. Que tenga buen día.',
      accion: { tipo: 'escalar' },
    }
  }

  if (contiene(t, ['no debo', 'ya pague', 'esto es un error', 'no tengo esa deuda'])) {
    return {
      texto: `Entiendo, ${nombre}. Paso su caso al área de cartera para que lo revisen con el soporte del crédito y le respondan por acá. Mientras tanto suspendo la gestión.`,
      accion: { tipo: 'escalar' },
    }
  }

  if (contiene(t, ['baja', 'no me escriban', 'no me contacten', 'stop'])) {
    return {
      texto: 'Listo. No le volvemos a escribir. Gracias por avisarnos.',
      accion: { tipo: 'ninguna' },
    }
  }

  // Pide más cuotas de las autorizadas: es la rama que muestra el escalamiento.
  const cuotasPedidas = cuotasEn(t)
  if (cuotasPedidas !== null && cuotasPedidas > limites.cuotasMax) {
    return {
      texto: `${nombre}, ${cuotasPedidas} cuotas se me sale de lo que tengo autorizado. Le paso el caso a un asesor para que lo revise y le responde por acá mismo.`,
      accion: { tipo: 'escalar' },
    }
  }

  if (
    contiene(t, [
      'cuotas',
      'partir',
      'plazo',
      'no tengo como pagar todo',
      'no puedo pagar todo',
      'de a poquitos',
    ])
  ) {
    return {
      texto: `${nombre}, su crédito ${obligacion.numeroCredito} tiene un saldo de ${cop(obligacion.saldoTotal)} y ${obligacion.diasMora} días de mora. Se lo puedo partir en ${cuotas} cuotas de ${cop(porCuota)}, la primera hoy y la segunda en 15 días. ¿Le sirve así?`,
      accion: { tipo: 'acuerdo', numeroCuotas: cuotas, montoTotal: obligacion.saldoTotal },
    }
  }

  if (
    contiene(t, [
      'link',
      'como pago',
      'mandeme',
      'envieme',
      'listo',
      'de acuerdo',
      'hagamosle',
      'hagale',
      'dale',
      'me sirve',
      'si señor',
      'esta bien',
    ])
  ) {
    const monto = ctx.cuotaPactada ?? porCuota
    return {
      texto: `Perfecto, ${nombre}. Acá le dejo el link para pagar ${cop(monto)}: ${MARCADOR_LINK}`,
      accion: { tipo: 'link', montoCop: monto },
    }
  }

  if (contiene(t, ['descuento', 'rebaja', 'condonacion'])) {
    return limites.descuentoMaxPct > 0
      ? {
          texto: `Le puedo aplicar hasta ${limites.descuentoMaxPct}% sobre los intereses de mora, ${nombre}. Sobre el capital no tengo autorización. ¿Con eso podría ponerse al día?`,
          accion: { tipo: 'ninguna' },
        }
      : {
          texto: `En este momento no tengo autorización para descuentos, ${nombre}. Le paso el caso a un asesor para que lo revise y le responda por acá.`,
          accion: { tipo: 'escalar' },
        }
  }

  if (contiene(t, ['sin trabajo', 'desempleado', 'enfermo', 'no tengo plata', 'estoy mal'])) {
    return {
      texto: `Lo lamento, ${nombre}. No le voy a insistir con el total. ¿Podría abonar ${cop(limites.montoMinimoAbono)} y me dice en qué fecha concreta le queda posible?`,
      accion: { tipo: 'ninguna' },
    }
  }

  if (contiene(t, ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'quien es', 'que es esto'])) {
    return {
      texto: `Buen día, ${nombre}. Le escribo por su crédito ${obligacion.numeroCredito}, que tiene un saldo pendiente de ${cop(obligacion.saldoTotal)}. ¿Le sirve que busquemos una forma de ponerlo al día?`,
      accion: { tipo: 'ninguna' },
    }
  }

  return {
    texto: `${nombre}, quiero entenderle bien para no darle una respuesta equivocada. Le paso el caso a un asesor y le responde por acá mismo.`,
    accion: { tipo: 'escalar' },
  }
}

/** «en 8 cuotas», «8 cuoticas», «ocho cuotas» → 8. */
function cuotasEn(texto: string): number | null {
  const enDigitos = texto.match(/(\d{1,2})\s*(cuota|cuotica|pago|mes)/)
  if (enDigitos) return Number(enDigitos[1])

  const palabras: Record<string, number> = {
    dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
    ocho: 8, nueve: 9, diez: 10, doce: 12,
  }
  for (const [palabra, valor] of Object.entries(palabras)) {
    if (new RegExp(`${palabra}\\s+(cuota|cuotica|pago|mes)`).test(texto)) return valor
  }
  return null
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function contiene(texto: string, agujas: readonly string[]): boolean {
  return agujas.some((a) => texto.includes(normalizar(a)))
}
