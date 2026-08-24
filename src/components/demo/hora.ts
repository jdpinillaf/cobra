/**
 * Formateo de hora determinista.
 *
 * `toLocaleTimeString` produce cadenas distintas en el servidor y en el
 * navegador aunque muestren lo mismo: cambia el separador entre la hora y el
 * a. m./p. m. según la versión de ICU (espacio normal contra espacio fino
 * inseparable). React lo detecta como hydration mismatch, y en la demo eso
 * aparece como el globo rojo de error de Next en la esquina — justo lo que no
 * puede estar en pantalla frente a un cliente.
 *
 * Armar la cadena a mano desde `formatToParts` elimina el problema: la zona
 * queda fija en Bogotá y los separadores los ponemos nosotros.
 */

const HORA_RELOJ = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const HORA_REGISTRO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const FECHA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function partes(formato: Intl.DateTimeFormat, iso: string): Record<string, string> {
  return Object.fromEntries(
    formato
      .formatToParts(new Date(iso))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
}

/** `11:02 p. m.` — como lo muestra WhatsApp en Colombia. */
export function horaDeReloj(iso: string): string {
  const p = partes(HORA_RELOJ, iso)
  const meridiano = p.dayPeriod === 'AM' ? 'a. m.' : 'p. m.'
  return `${p.hour}:${p.minute} ${meridiano}`
}

/** `23:02:04` — hora de Bogotá, que es la que vale para la Ley 2300. */
export function horaDeRegistro(iso: string): string {
  const p = partes(HORA_REGISTRO, iso)
  return `${p.hour}:${p.minute}:${p.second}`
}

/** `13/08/2026`. */
export function fechaCorta(iso: string): string {
  const p = partes(FECHA, iso)
  return `${p.day}/${p.month}/${p.year}`
}
