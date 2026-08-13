/**
 * Toda evaluación de la Ley 2300 se hace en hora de Bogotá, nunca en la hora
 * del servidor. Un servidor en UTC evaluando "¿son más de las 7 pm?" bloquea o
 * permite envíos con cinco horas de error.
 */

const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface InstanteBogota {
  /** `YYYY-MM-DD` en hora local de Colombia. */
  fecha: string
  anio: number
  mes: number
  dia: number
  hora: number
  minuto: number
  /** 0 = domingo, 1 = lunes … 6 = sábado. */
  diaSemana: number
  /** Minutos desde medianoche, para comparar contra ventanas horarias. */
  minutosDelDia: number
}

export function enBogota(instante: Date): InstanteBogota {
  const partes = Object.fromEntries(
    FORMATO.formatToParts(instante)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>

  const anio = Number(partes.year)
  const mes = Number(partes.month)
  const dia = Number(partes.day)
  const hora = Number(partes.hour)
  const minuto = Number(partes.minute)

  // El día de la semana se deriva de las partes ya convertidas a Bogotá,
  // reconstruyéndolas en UTC para que getUTCDay no vuelva a desplazarlas.
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()

  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    anio,
    mes,
    dia,
    hora,
    minuto,
    diaSemana,
    minutosDelDia: hora * 60 + minuto,
  }
}

/**
 * Construye un instante a partir de una fecha y hora de pared de Bogotá.
 *
 * Colombia está en UTC-5 fijo y no aplica horario de verano desde 1993, así que
 * el offset se puede escribir literal. Si eso llegara a cambiar, este es el
 * único punto del código que habría que tocar.
 */
export function desdeBogota(fecha: string, hora: number, minuto = 0): Date {
  const hh = String(hora).padStart(2, '0')
  const mm = String(minuto).padStart(2, '0')
  return new Date(`${fecha}T${hh}:${mm}:00-05:00`)
}

/** Suma días de calendario a una fecha `YYYY-MM-DD`. */
export function sumarDias(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`)
  const movida = new Date(base.getTime() + dias * 86_400_000)
  return movida.toISOString().slice(0, 10)
}

/** Reloj inyectable: producción usa el del sistema, la demo uno acelerado. */
export interface Reloj {
  ahora(): Date
}

export const relojSistema: Reloj = {
  ahora: () => new Date(),
}

export function relojFijo(instante: Date | string): Reloj {
  const fijo = typeof instante === 'string' ? new Date(instante) : instante
  return { ahora: () => fijo }
}
