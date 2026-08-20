import type { Consentimiento } from '@/domain/types'
import { normalizar } from './texto-entrante'

/**
 * Opt-out del deudor por respuesta.
 *
 * La Ley 2300 le da al deudor el derecho de que lo dejen de contactar, y Meta
 * castiga el quality rating cuando la gente reporta. El campo
 * `Consentimiento.revocadoEn` existía desde el principio y **nada lo escribía**:
 * este archivo es lo que lo conecta con la realidad.
 *
 * Se prefiere el falso positivo al falso negativo: dejar de escribirle a quien
 * no pidió la baja cuesta una recuperación; seguir escribiéndole a quien sí la
 * pidió cuesta una queja ante la SIC y el número de WhatsApp del cliente.
 */

/**
 * Palabras que por sí solas son una baja.
 *
 * Se comparan como palabra completa: `baja` sí, pero "voy a dar de baja el
 * carro" también entra, y está bien — el costo del falso positivo es menor.
 */
const PALABRAS_BAJA = ['baja', 'stop', 'unsubscribe', 'desuscribir', 'desuscribirme']

/** Frases que expresan la baja sin usar una palabra clave. */
const FRASES_BAJA = [
  'no me contacten',
  'no me contacte',
  'no contactar',
  'no me escriban',
  'no me escriba',
  'no me vuelvan a escribir',
  'no me vuelva a escribir',
  'no me llamen',
  'no me manden mas',
  'no mas mensajes',
  'dejen de escribirme',
  'deje de escribirme',
  'dejen de molestar',
  'dar de baja',
  'darme de baja',
  'retirar mi numero',
  'eliminar mis datos',
  'borrar mis datos',
  'revoco',
  'revocar autorizacion',
  'no autorizo',
]

/**
 * ¿Este mensaje entrante es una revocación?
 *
 * **`cancelar` no cuenta.** En Colombia "cancelar" significa habitualmente
 * *pagar*: "ya cancelé la cuota" es lo contrario de una baja. Tratarla como
 * opt-out apagaría la cadencia justo del deudor que está pagando.
 */
export function detectarOptOut(cuerpo: string): boolean {
  const texto = normalizar(cuerpo)
  if (!texto) return false

  const palabras = new Set(texto.split(' '))
  if (PALABRAS_BAJA.some((p) => palabras.has(p))) return true

  return FRASES_BAJA.some((f) => texto.includes(f))
}

/**
 * Revoca el consentimiento.
 *
 * Es idempotente y **no se puede deshacer por otro mensaje entrante**: si el
 * deudor luego escribe otra cosa, eso no reactiva la cadencia. Volver a
 * contactarlo exige un consentimiento nuevo y explícito, registrado por el
 * cliente. El guard ya lo respeta con el motivo `opt_out`.
 */
export function aplicarOptOut(consentimiento: Consentimiento, en: string): Consentimiento {
  if (consentimiento.revocadoEn) return consentimiento
  return { ...consentimiento, revocadoEn: en }
}
