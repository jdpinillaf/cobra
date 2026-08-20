import { normalizar } from './texto-entrante'

/**
 * "Este no es mi número."
 *
 * Hermano de `detectarOptOut`, y vive aparte porque el balance de errores es
 * otro. La baja es del deudor, permanente e irreversible. Esto es una
 * **afirmación por verificar**: el número puede estar bien y la persona estar
 * esquivando, así que la consecuencia es parar la gestión y pasarle el caso a
 * un humano, no borrar al deudor de la cartera.
 *
 * Hasta ahora esto no existía en el camino real. El deudor escribía "yo no
 * soy", el webhook registraba el entrante, **abría la ventana de 24 h** y la
 * cadencia seguía escribiéndole. Lo único que reaccionaba era la herramienta
 * `marcarNumeroErrado` del agente, que muta un objeto en memoria de la demo.
 *
 * Seguir contactando a un tercero que dijo que no es el deudor no es una
 * molestia: es tratamiento de datos de alguien que nunca autorizó nada.
 */

/**
 * Frases que afirman que el destinatario no es el deudor.
 *
 * Todas son específicas a propósito. `guionado.ts` usa un juego más flojo
 * —`'se equivoco'` a secas— y ahí está bien, porque solo decide qué contesta el
 * agente. Acá la consecuencia es frenar la gestión de una obligación real, así
 * que "se equivocó en el monto" no puede entrar.
 */
const FRASES = [
  'numero equivocado',
  'numero esta equivocado',
  'equivocado el numero',
  'no es mi numero',
  'no es el numero',
  'este numero no es',
  'se equivoco de numero',
  'se equivocaron de numero',
  'se equivoco de persona',
  'se equivocaron de persona',
  'no conozco a esa persona',
  'no conozco a ese senor',
  'no conozco a esa senora',
  'no vive aqui',
  'no vive aca',
  'aqui no vive',
  'aca no vive',
  'marco mal',
  'marcaron mal',
  'numero errado',
]

/**
 * "No soy…", salvo cuando es "no soy capaz".
 *
 * En Colombia "no soy capaz" quiere decir *no puedo*, y es de las respuestas más
 * comunes de un deudor sin plata. Tomarla por un número equivocado frenaría la
 * gestión justo del que está diciendo que no le alcanza.
 */
const NO_SOY = /\bno soy\b(?! capaz)/

export function detectarNumeroErrado(cuerpo: string): boolean {
  const texto = normalizar(cuerpo)
  if (!texto) return false

  if (NO_SOY.test(texto)) return true
  return FRASES.some((f) => texto.includes(f))
}
