/**
 * El monto del correo del banco, a centavos enteros.
 *
 * Es la función más chica del producto y la que más caro se paga si está mal:
 * el monto exacto es la señal **obligatoria** del cruce (`src/conciliacion` no
 * concilia nada con tolerancia), así que un error acá no produce un número raro
 * en una pantalla — produce una confirmación de un pago que no existió, o un
 * pago real que nunca se confirma.
 *
 * Bancolombia escribe el mismo evento de dos maneras y en formato numérico
 * gringo: `$100,000.00` en la plantilla de llaves y `$600,000` en la de
 * transferencia. Coma para miles, punto para decimales.
 *
 * **El intento obvio de detectar el formato por la presencia de una coma está
 * mal, y el modo de falla es silencioso.** Con esa regla `"500.00"` se leía
 * como `$50.000`: multiplicaba por cien cualquier monto con centavos y sin
 * separador de miles. La plantilla de llaves **siempre** trae centavos, así que
 * la ventana no era teórica.
 *
 * Lo que se hace en cambio es sacar primero los separadores de miles —los que
 * van seguidos de exactamente tres dígitos y de otro separador o del final— y
 * recién entonces leer lo que quede.
 */

/**
 * Lanza, no devuelve `NaN`.
 *
 * `parseFloat` devuelve `NaN` ante cualquier sorpresa, `Math.round(NaN * 100)`
 * sigue siendo `NaN`, y eso se inserta como cero o como null según el driver.
 * Un monto en cero cruzando contra cualquier cosa es peor que un correo sin
 * parsear: el correo sin parsear dispara una alerta el mismo día.
 */
export function parseMonto(crudo: string): number {
  const limpio = crudo.trim().replace(/^\$/, '').trim()

  // Separador de miles: punto o coma seguidos de exactamente 3 dígitos y de
  // otro separador o del final. `"1.500.000"` pierde los dos; `"500.00"` no
  // pierde ninguno porque después del punto hay dos dígitos, no tres.
  const sinMiles = limpio.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '')

  // Lo que quede como separador seguido de uno o dos dígitos al final son
  // centavos. Cualquier otra cosa es basura y no se adivina.
  const partes = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(sinMiles)
  if (!partes) throw new Error(`Monto ilegible: ${JSON.stringify(crudo)}`)

  const enteros = Number(partes[1])
  const centavos = Number((partes[2] ?? '0').padEnd(2, '0'))

  // `Number` sobre 16 dígitos ya pierde precisión, y un monto así en un correo
  // de Bancolombia es un parseo que salió mal, no una transferencia.
  if (!Number.isSafeInteger(enteros)) {
    throw new Error(`Monto fuera de rango: ${JSON.stringify(crudo)}`)
  }

  return enteros * 100 + centavos
}
