import type { Clasificacion } from '@/repo/raw-emails'

/**
 * De qué habla este correo.
 *
 * Existe para poder **no guardar** lo que no hace falta. En producción todo lo
 * que no es un ingreso se descarta sin persistir, y eso no es una optimización:
 * un aviso de egreso trae a quién le pagó el comerciante y cuánto, un correo de
 * seguridad trae señales de su cuenta, y guardar menos datos financieros de
 * terceros es a la vez menos riesgo y el argumento de venta del §5 del plan.
 *
 * La clasificación es por palabras y a propósito no usa los patrones del
 * parser. Son dos preguntas distintas: "¿de qué habla?" tiene que seguir
 * respondiendo bien el día que Bancolombia cambie la redacción y el parser deje
 * de matchear, porque es lo que decide si ese correo se guarda para poder
 * arreglar el parser. Si dependiera del parser, el día que se rompa se
 * descartaría justo la evidencia que hace falta para repararlo.
 */

const SENALES: Array<{ clasificacion: Clasificacion; patron: RegExp }> = [
  // Egreso primero: "realizaste una transferencia" contiene "transferencia", y
  // evaluarlo después haría que un pago saliente entrara como ingreso.
  {
    clasificacion: 'egreso',
    patron:
      /\b(realizaste|hiciste|enviaste)\s+(una\s+)?(transferencia|pago|env[ií]o)|\bpagaste\b|\bcompra\s+(aprobada|exitosa)|\bretiro\b|\bd[eé]bito\b/i,
  },
  {
    clasificacion: 'ingreso',
    patron:
      /\brecibiste\s+(una\s+transferencia|un\s+pago|una\s+consignaci[oó]n)|\bte\s+(consignaron|transfirieron)\b|\bconsignaci[oó]n\s+recibida\b|\bcr[eé]dito\s+a\s+tu\s+cuenta\b/i,
  },
  {
    clasificacion: 'seguridad',
    patron:
      /\b(clave|contrase[nñ]a|token|c[oó]digo\s+de\s+seguridad|bloque[oó]|inicio\s+de\s+sesi[oó]n|intento\s+de\s+acceso)\b/i,
  },
]

export function clasificar(texto: string): Clasificacion {
  const plano = texto.replace(/\s+/g, ' ')
  for (const { clasificacion, patron } of SENALES) {
    if (patron.test(plano)) return clasificacion
  }
  // `otro` y no `desconocido`: se leyó y no se reconoció. `desconocido` queda
  // para el correo que ni siquiera se pudo leer.
  return 'otro'
}
