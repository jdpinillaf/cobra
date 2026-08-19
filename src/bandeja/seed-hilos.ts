import type { ResultadoEnvio } from '@/domain/types'

/**
 * Conversaciones de desarrollo.
 *
 * Sirve para construir la bandeja antes de que el webhook escriba datos reales.
 * Eso es un préstamo, y la forma de que salga barato es que el seed sea
 * **incómodo a propósito**: hilos de dos mensajes y de cuarenta, nombres largos,
 * intentos bloqueados por ley, notas, etiquetas, y conversaciones que nadie leyó.
 *
 * Si solo produjera hilos cortos y prolijos, la pantalla se vería hermosa
 * mientras se construye y se rompería con el primer caso real.
 *
 * Determinista por semilla: la misma bandeja en cada corrida hace que una
 * captura de pantalla de ayer siga siendo comparable hoy.
 */

/** PRNG determinista, el mismo que usa `src/demo/seed.ts`. */
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const DEL_DEUDOR = [
  'buenas, ya hice el pago ayer',
  'no puedo pagar todo, me sirve por cuotas?',
  'quien habla?',
  'ya le mandé el comprobante a la señorita',
  'este mes no tengo, me quedé sin trabajo',
  'yo no soy, ese número está equivocado',
  'cuánto es lo que debo exactamente',
  'páseme el link otra vez que se me perdió',
  'ya pagué, revisen bien por favor',
  'estoy en eso, deme unos días',
  '',
]

const DEL_AGENTE = [
  'Hola, le escribimos de Ferretería El Tornillo por su factura pendiente.',
  'Con gusto. El saldo a hoy es de $1.245.000 y puede pagarlo en dos cuotas.',
  'Le comparto el link de pago. Cualquier cosa me escribe por acá.',
  'Perfecto, quedo atento al comprobante.',
  'Entiendo. ¿Le sirve que lo dividamos en tres cuotas quincenales?',
]

const NOTAS = [
  'Lo llamé, dice que paga el viernes. Confirmar.',
  'Cliente de años, tratarlo con cuidado. Habló el gerente.',
  'Dice que le llegó doble cobro. Revisar con contabilidad antes de insistir.',
  'Número contestado por la esposa. No es el titular.',
]

const ETIQUETAS = ['promesa de pago', 'en disputa', 'no contesta', 'número errado']

const BLOQUEOS = ['fuera_de_ventana_legal', 'limite_semanal', 'domingo', 'festivo']

export interface MensajeSeed {
  ocurridoEn: string
  direccion: 'entrante' | 'saliente'
  cuerpo: string
  resultado: ResultadoEnvio
  motivoBloqueo: string | null
}

export interface HiloSeed {
  deudorId: string
  obligacionId: string
  mensajes: MensajeSeed[]
  notas: Array<{ cuerpo: string; usuarioId: string; ocurridoEn: string }>
  etiquetas: string[]
  agentePausado: boolean
  motivoPausa: string | null
  asignadaA: string | null
  /** Quiénes NO lo han leído. Vacío = todos al día. */
  sinLeerPara: string[]
}

export interface OpcionesHilos {
  obligaciones: Array<{ id: string; deudorId: string; deudorNombre: string; diasMora: number }>
  usuarios: string[]
  /** ISO. Ningún mensaje se genera después de este instante. */
  ahora: string
  semilla?: number
}

const MINUTO = 60_000

export function generarHilos(opciones: OpcionesHilos): HiloSeed[] {
  const rnd = mulberry32(opciones.semilla ?? 42)
  const ahora = new Date(opciones.ahora).getTime()
  const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]

  return opciones.obligaciones.map((o, i) => {
    // El largo del hilo se reparte a propósito en los tres casos que se ven
    // distinto en pantalla: el de dos mensajes, el normal, y el que obliga a
    // hacer scroll. Uno de cada tipo garantizado por el índice.
    const largo = i % 10 === 0 ? 2 : i % 7 === 0 ? 22 + Math.floor(rnd() * 18) : 3 + Math.floor(rnd() * 8)

    // El hilo termina hace entre 5 minutos y 6 días. Eso da una bandeja con
    // mezcla de "recién" y "hace rato", que es como se ve una real.
    const finEn = ahora - Math.floor(rnd() * 6 * 24 * 60) * MINUTO - 5 * MINUTO
    const mensajes: MensajeSeed[] = []

    for (let m = largo - 1; m >= 0; m--) {
      const entrante = m % 2 === 1
      // Uno de cada doce salientes fue bloqueado por la ley. Son parte del hilo
      // y son la evidencia; esconderlos haría parecer que nunca se intentó.
      const bloqueado = !entrante && rnd() < 1 / 12
      mensajes.push({
        ocurridoEn: new Date(finEn - m * (7 + Math.floor(rnd() * 90)) * MINUTO).toISOString(),
        direccion: entrante ? 'entrante' : 'saliente',
        cuerpo: bloqueado ? '' : entrante ? elegir(DEL_DEUDOR) : elegir(DEL_AGENTE),
        resultado: bloqueado ? 'bloqueado' : entrante ? 'entregado' : elegir(['entregado', 'leido'] as const),
        motivoBloqueo: bloqueado ? elegir(BLOQUEOS) : null,
      })
    }
    mensajes.sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn))

    const pausado = i % 6 === 0
    const asignadaA = i % 4 === 3 ? null : opciones.usuarios[i % opciones.usuarios.length]
    const conNota = i % 5 === 0

    return {
      deudorId: o.deudorId,
      obligacionId: o.id,
      mensajes,
      notas: conNota
        ? [
            {
              cuerpo: elegir(NOTAS),
              usuarioId: elegir(opciones.usuarios),
              ocurridoEn: new Date(finEn - 3 * MINUTO).toISOString(),
            },
          ]
        : [],
      etiquetas: i % 3 === 0 ? [elegir(ETIQUETAS)] : [],
      agentePausado: pausado,
      motivoPausa: pausado ? 'Lo estoy manejando yo' : null,
      asignadaA,
      // Sin leer para todos menos para quien lo tiene asignado, salvo un tercio
      // que queda sin leer incluso para su dueño: es el caso que duele y el que
      // la bandeja tiene que hacer visible.
      sinLeerPara:
        i % 3 === 1
          ? opciones.usuarios
          : opciones.usuarios.filter((u) => u !== asignadaA),
    }
  })
}
