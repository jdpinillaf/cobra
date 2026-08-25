/**
 * Qué salió de la llamada.
 *
 * El resultado **se deriva de las acciones ejecutadas, no del texto**. Un
 * resumen escrito por un modelo puede decir «quedamos en un acuerdo» sin que
 * exista el acuerdo: por teléfono el modelo transcribe lo que creyó oír, y esa
 * frase terminaría en una pantalla que el cliente usa para decidir a quién
 * volver a llamar.
 */
import type { AccionEjecutada } from './funciones'
import type { TurnoVoz } from './agente'

export type ResultadoLlamada =
  | 'acuerdo'
  | 'promesa'
  | 'sin_acuerdo'
  | 'numero_errado'
  | 'escalado'
  | 'sin_contacto'
  | 'baja'

export interface ResumenLlamada {
  texto: string
  resultado: ResultadoLlamada
}

/** El resultado, leído de lo que el código hizo. Sin modelo y sin ambigüedad. */
export function resultadoDe(
  turnos: TurnoVoz[],
  acciones: AccionEjecutada[],
  motivoFin?: string,
): ResultadoLlamada {
  const hecha = (nombre: string) => acciones.some((a) => a.nombre === nombre && a.estado === 'ok')

  // El orden es la regla de negocio, no una preferencia de estilo.
  //
  // La baja va primero que todo: el agente puede haber alcanzado a proponer un
  // acuerdo antes de que la persona pidiera que no la contacten más, y leer esa
  // fila como «promesa» llevaría a volver a llamarla.
  if (motivoFin === 'baja') return 'baja'
  if (hecha('marcarNumeroErrado')) return 'numero_errado'
  if (!turnos.some((t) => t.quien === 'deudor')) return 'sin_contacto'
  // El link ya salió: hay plata en movimiento, y eso manda sobre todo lo demás.
  if (hecha('generarLinkDePago')) return 'acuerdo'
  // Escalar es terminal: el caso quedó en manos de una persona. Va antes que
  // `promesa` porque una llamada que terminó escalando no se vuelve a llamar
  // igual que una que quedó en una promesa sin cerrar.
  if (hecha('escalarAHumano')) return 'escalado'
  if (hecha('proponerAcuerdo')) return 'promesa'
  return 'sin_acuerdo'
}

const FRASE: Record<ResultadoLlamada, string> = {
  baja: 'Pidió que no lo vuelvan a contactar. Consentimiento revocado y gestión detenida.',
  acuerdo: 'Aceptó el plan de pago y se le envió el link de la primera cuota.',
  promesa: 'Se acordó un plan de pago, pero no llegó a pedir el link.',
  sin_acuerdo: 'Habló, pero no se cerró ningún acuerdo.',
  numero_errado: 'El número no corresponde al titular. Quedó marcado y la gestión se detuvo.',
  escalado: 'Pidió algo fuera de lo autorizado. Pasó a un asesor.',
  sin_contacto: 'Nadie habló del otro lado. Probablemente contestó un buzón.',
}

/**
 * Resumen determinista. Es el que se usa cuando no hay modelo, y el respaldo
 * cuando lo hay: una llamada sin resumen es una fila que nadie va a abrir.
 */
export function resumirSinModelo(
  turnos: TurnoVoz[],
  acciones: AccionEjecutada[],
  motivoFin?: string,
): ResumenLlamada {
  const resultado = resultadoDe(turnos, acciones, motivoFin)
  const bloqueadas = acciones.filter((a) => a.estado === 'bloqueado')
  const dichoPorElDeudor = turnos.filter((t) => t.quien === 'deudor').map((t) => t.texto)

  const partes = [FRASE[resultado]]
  if (bloqueadas.length > 0) {
    partes.push(
      `Pidió algo que los límites del cliente no permiten (${bloqueadas.length} ${
        bloqueadas.length === 1 ? 'intento rechazado' : 'intentos rechazados'
      }).`,
    )
  }
  if (dichoPorElDeudor.length > 0) {
    partes.push(`Dijo: «${dichoPorElDeudor[dichoPorElDeudor.length - 1]}».`)
  }

  return { texto: partes.join(' '), resultado }
}
