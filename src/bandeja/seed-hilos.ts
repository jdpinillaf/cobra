import { esFestivo } from '@/compliance/festivos'
import { desdeBogota, enBogota, sumarDias } from '@/compliance/reloj-bogota'
import { cop } from '@/lib/formato'
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
 * **Incómodo no es incoherente.** Antes cada frase salía de un sorteo
 * independiente sobre un pool plano: el deudor decía "yo no soy, ese número está
 * equivocado" y el agente seguía negociando cuotas dos mensajes después. Eso no
 * es un dato feo, es un dato imposible, y construir contra datos imposibles
 * esconde justo los estados que la pantalla tiene que saber dibujar — el hilo
 * que se cerró, el deudor que ya no es contactable, el caso que un humano tomó.
 *
 * Ahora cada hilo sigue un **guion**: un arco completo de turnos, más el estado
 * que ese arco deja. Los textos salen de `src/agent/guionado.ts`, que es lo que
 * el agente responde de verdad cuando no hay modelo, así el seed y el agente
 * hablan el mismo idioma y la bandeja sembrada se parece a la que va a haber.
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

/** Lo que un turno del guion puede nombrar. Todo sale de la obligación real. */
export interface ContextoGuion {
  nombre: string
  empresa: string
  credito: string
  saldo: string
  cuota: string
  abono: string
  diasMora: number
}

export interface Turno {
  de: 'deudor' | 'agente'
  texto: (c: ContextoGuion) => string
  /**
   * Un intento de cadencia, no una respuesta.
   *
   * Cambia dos cosas: el hueco hasta el turno siguiente se mide en días y no en
   * minutos, y es el único lugar donde el guard puede haber bloqueado el envío.
   * Dentro de una conversación viva, con la ventana de 24 h abierta, un bloqueo
   * por horario no tiene cómo pasar.
   */
  intento?: boolean
}

export interface Guion {
  id: string
  turnos: Turno[]
  etiqueta: string | null
  nota: string | null
  /** El hilo termina acá. No se escribe nada después, ni siquiera cadencia. */
  cierra: boolean
  /** Un humano se hizo cargo. */
  pausa: boolean
  /** Lo que este arco dejó escrito sobre el deudor, no sobre el hilo. */
  marca: 'opt-out' | 'numero-errado' | null
}

/**
 * El primer mensaje de todo hilo, siempre.
 *
 * No es parte de ningún guion: se antepone. Cuando era el primer turno de cada
 * arco, los hilos largos metían los meses de cadencia **antes** y la
 * presentación aparecía en el mensaje veinte, con el deudor ya respondiendo. Un
 * hilo de cobranza empieza porque la empresa escribe, y esa frase va primero.
 */
const APERTURA: Turno = {
  de: 'agente',
  texto: (c) =>
    `Buen día, ${c.nombre}. Le escribo de ${c.empresa} por su crédito ${c.credito}, que tiene un saldo pendiente de ${c.saldo} y ${c.diasMora} días de mora. ¿Le sirve que busquemos una forma de ponerlo al día?`,
  intento: true,
}

/**
 * Los ocho arcos.
 *
 * Los textos del agente son los de `responderGuionado`, con el mismo orden de
 * precedencia: número errado y disputa escalan antes que cualquier negociación,
 * y la baja se confirma una sola vez.
 */
export const GUIONES: Guion[] = [
  {
    id: 'apenas-abierto',
    // El caso más corto que existe y el que más duele en la bandeja: el deudor
    // contestó y nadie le respondió todavía.
    turnos: [{ de: 'deudor', texto: () => 'quien habla?' }],
    etiqueta: null,
    nota: null,
    cierra: false,
    pausa: false,
    marca: null,
  },
  {
    id: 'promesa',
    turnos: [
      { de: 'deudor', texto: () => 'estoy en eso, deme unos días' },
      {
        de: 'agente',
        texto: (c) =>
          `Con gusto, ${c.nombre}. ¿Me confirma una fecha concreta para dejarla anotada y no volver a molestarlo antes?`,
      },
      { de: 'deudor', texto: () => 'el viernes de la otra semana sin falta' },
      { de: 'agente', texto: () => 'Perfecto. Queda anotado. Cualquier cosa me escribe por acá.' },
    ],
    etiqueta: 'promesa de pago',
    nota: 'Lo llamé, dice que paga el viernes. Confirmar.',
    cierra: false,
    pausa: false,
    marca: null,
  },
  {
    id: 'cuotas',
    turnos: [
      { de: 'deudor', texto: () => 'no puedo pagar todo, me sirve por cuotas?' },
      {
        de: 'agente',
        texto: (c) =>
          `${c.nombre}, su crédito ${c.credito} tiene un saldo de ${c.saldo}. Se lo puedo partir en 2 cuotas de ${c.cuota}, la primera hoy y la segunda en 15 días. ¿Le sirve así?`,
      },
      { de: 'deudor', texto: () => 'listo, me sirve' },
      {
        de: 'agente',
        texto: (c) => `Perfecto, ${c.nombre}. Acá le dejo el link para pagar ${c.cuota}: https://pagar.ponox.co/d/seed`,
      },
      { de: 'deudor', texto: () => 'ya pagué la primera, le mando el soporte' },
      { de: 'agente', texto: () => 'Recibido. Le queda la segunda cuota en 15 días. Gracias.' },
    ],
    etiqueta: 'promesa de pago',
    nota: null,
    cierra: false,
    pausa: false,
    marca: null,
  },
  {
    id: 'ya-pague',
    turnos: [
      { de: 'deudor', texto: () => 'yo ya pagué eso, revisen bien por favor' },
      {
        de: 'agente',
        texto: (c) =>
          `Entiendo, ${c.nombre}. Paso su caso al área de cartera para que lo revisen con el soporte del crédito y le respondan por acá. Mientras tanto suspendo la gestión.`,
      },
    ],
    etiqueta: 'en disputa',
    nota: 'Dice que le llegó doble cobro. Revisar con contabilidad antes de insistir.',
    cierra: true,
    pausa: true,
    marca: null,
  },
  {
    id: 'numero-errado',
    turnos: [
      { de: 'deudor', texto: () => 'yo no soy, ese número está equivocado' },
      {
        de: 'agente',
        texto: () =>
          'Le ofrezco disculpas por la molestia. Marco este número para no volver a escribirle. Que tenga buen día.',
      },
    ],
    etiqueta: 'número errado',
    nota: 'Número contestado por la esposa. No es el titular.',
    cierra: true,
    pausa: true,
    marca: 'numero-errado',
  },
  {
    id: 'pide-la-baja',
    turnos: [
      { de: 'deudor', texto: () => 'no me escriban más por favor' },
      { de: 'agente', texto: () => 'Listo. No le volvemos a escribir. Gracias por avisarnos.' },
    ],
    // Sin etiqueta y sin pausa a propósito: al agente no lo calla un asesor, lo
    // calla el guard, y esa diferencia es la que separa una decisión operativa
    // de una prohibición legal.
    etiqueta: null,
    nota: null,
    cierra: true,
    pausa: false,
    marca: 'opt-out',
  },
  {
    id: 'situacion-dificil',
    turnos: [
      { de: 'deudor', texto: () => 'este mes no tengo, me quedé sin trabajo' },
      {
        de: 'agente',
        texto: (c) =>
          `Lo lamento, ${c.nombre}. No le voy a insistir con el total. ¿Podría abonar ${c.abono} y me dice en qué fecha concreta le queda posible?`,
      },
      { de: 'deudor', texto: () => 'déjeme ver a fin de mes cuando me paguen la liquidación' },
      { de: 'agente', texto: () => 'Quedo atento. No le escribo hasta fin de mes.' },
    ],
    etiqueta: null,
    nota: 'Cliente de años, tratarlo con cuidado. Habló el gerente.',
    cierra: false,
    pausa: false,
    marca: null,
  },
  {
    id: 'sin-respuesta',
    // Solo salientes. Es la mitad de una cartera real y el hilo que la bandeja
    // tiene que saber mostrar sin que parezca roto.
    turnos: [
      {
        de: 'agente',
        texto: (c) => `${c.nombre}, le recuerdo el saldo de ${c.saldo} de su crédito ${c.credito}. Quedo atento.`,
        intento: true,
      },
      {
        de: 'agente',
        texto: (c) =>
          `${c.nombre}, sigo a la orden para buscar un acuerdo sobre su crédito ${c.credito}. Si prefiere que lo llamemos, me avisa por acá.`,
        intento: true,
      },
    ],
    etiqueta: 'no contesta',
    nota: null,
    cierra: false,
    pausa: false,
    marca: null,
  },
]

/** Intentos de cadencia sin respuesta, para los hilos largos. */
const INTENTOS: Array<(c: ContextoGuion) => string> = [
  (c) => `${c.nombre}, le recuerdo que su crédito ${c.credito} sigue con un saldo de ${c.saldo}. Quedo atento.`,
  (c) => `Buen día, ${c.nombre}. ¿Le sirve que le arme un plan de pagos para el crédito ${c.credito}?`,
  (c) => `${c.nombre}, su obligación con ${c.empresa} lleva ${c.diasMora} días de mora. Podemos buscar una salida.`,
  (c) => `${c.nombre}, con un abono de ${c.abono} podemos frenar el aumento de intereses. ¿Le sirve?`,
]

/**
 * Idas y vueltas que no resuelven nada, y el hilo sigue.
 *
 * La pregunta y la respuesta van **juntas**. Sorteadas por separado salía el
 * deudor preguntando "cuánto es lo que debo exactamente" y el agente
 * contestando "sin problema, quedo atento" — que es la misma incoherencia que
 * los guiones vinieron a arreglar, colada por la puerta de atrás.
 */
const RONDAS: Array<{ deudor: string; agente: (c: ContextoGuion) => string }> = [
  {
    deudor: 'ahorita no puedo, después le escribo',
    agente: (c) => `Sin problema, ${c.nombre}. Quedo atento.`,
  },
  {
    deudor: 'estoy en eso, deme unos días',
    agente: () => '¿Me confirma una fecha concreta y no le vuelvo a escribir antes?',
  },
  {
    deudor: 'páseme el link otra vez que se me perdió',
    agente: () => 'Acá le dejo el link de nuevo: https://pagar.ponox.co/d/seed',
  },
  {
    deudor: 'cuánto es lo que debo exactamente',
    agente: (c) => `El saldo a hoy es ${c.saldo}, ${c.nombre}, con ${c.diasMora} días de mora.`,
  },
]

/**
 * La ventana legal de la Ley 2300, copiada de `guard.ts`.
 *
 * Se duplica a propósito y no se importa: `guard.ts` la tiene privada porque es
 * la regla que aplica al enviar, y el seed no envía — coloca. Si algún día
 * divergen, el test de este archivo lo dice, porque compara cada instante
 * generado contra el guard de verdad.
 */
const VENTANA: ReadonlyArray<{ desde: number; hasta: number } | null> = [
  null, // domingo
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 7 * 60, hasta: 19 * 60 },
  { desde: 8 * 60, hasta: 15 * 60 }, // sábado
]

function permitido(instante: number): boolean {
  const t = enBogota(new Date(instante))
  const v = VENTANA[t.diaSemana]
  if (!v || esFestivo(t.fecha)) return false
  return t.minutosDelDia >= v.desde && t.minutosDelDia < v.hasta
}

/**
 * El último momento hasta acá en que el agente podía escribir.
 *
 * El seed ponía los salientes donde cayera el sorteo, así que sembraba mensajes
 * **entregados un domingo**. El hilo es la evidencia que se le muestra a la SIC:
 * mostrarle un envío hecho un domingo no es un dato feo, es la confesión de la
 * infracción que el producto se vende por evitar.
 *
 * Busca hacia atrás y no hacia adelante porque el hilo se coloca desde su final.
 * Ver el comentario de la colocación, más abajo.
 */
function ultimoMomentoPermitido(instante: number): number {
  let ms = instante
  for (let vuelta = 0; vuelta < 14; vuelta++) {
    if (permitido(ms)) return ms
    const t = enBogota(new Date(ms))
    const v = VENTANA[t.diaSemana]
    if (v && !esFestivo(t.fecha) && t.minutosDelDia >= v.hasta) {
      return desdeBogota(t.fecha, v.hasta / 60 - 1, 30).getTime()
    }
    const ayer = sumarDias(t.fecha, -1)
    const vAyer = VENTANA[enBogota(desdeBogota(ayer, 12)).diaSemana]
    ms = vAyer
      ? desdeBogota(ayer, vAyer.hasta / 60 - 1, 30).getTime()
      : desdeBogota(ayer, 12).getTime()
  }
  return ms
}

/**
 * Lo contrario, y por la misma razón.
 *
 * Un intento bloqueado ocurrió, por definición, cuando la ley no dejaba. Si el
 * seed lo pone un miércoles a las diez de la mañana, el motivo que lo acompaña
 * lo desmiente y el registro de cumplimiento pierde sentido.
 */
function anteriorMomentoProhibido(instante: number): number {
  if (!permitido(instante)) return instante
  const t = enBogota(new Date(instante))
  const v = VENTANA[t.diaSemana]!
  // Ese mismo día, antes de la apertura. Es anterior al instante original, así
  // que el hilo no se desordena.
  return desdeBogota(t.fecha, v.desde / 60 - 1, 40).getTime()
}

/** Por qué el guard paró ese intento, leído de la fecha en que quedó. */
function motivoDelBloqueo(instante: number, rnd: () => number): string {
  const t = enBogota(new Date(instante))
  if (t.diaSemana === 0) return 'domingo'
  if (esFestivo(t.fecha)) return 'festivo'
  return rnd() < 0.5 ? 'fuera_de_horario_legal' : 'limite_semanal'
}

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
  /** `Guion.id`, para poder explicar en un test por qué el hilo dice lo que dice. */
  guion: string
  mensajes: MensajeSeed[]
  notas: Array<{ cuerpo: string; usuarioId: string; ocurridoEn: string }>
  etiquetas: string[]
  agentePausado: boolean
  motivoPausa: string | null
  asignadaA: string | null
  /** Lo que el arco dejó escrito sobre el deudor. `sembrarHilos` lo aplica. */
  marca: 'opt-out' | 'numero-errado' | null
  /** Quiénes NO lo han leído. Vacío = todos al día. */
  sinLeerPara: string[]
}

export interface OpcionesHilos {
  obligaciones: Array<{
    id: string
    deudorId: string
    deudorNombre: string
    numeroCredito: string
    saldoTotal: number
    diasMora: number
  }>
  usuarios: string[]
  /** Quién cobra. Va en la apertura de cada hilo. */
  empresa: string
  /** ISO. Ningún mensaje se genera después de este instante. */
  ahora: string
  semilla?: number
}

const MINUTO = 60_000
const DIA = 24 * 60 * MINUTO

export function generarHilos(opciones: OpcionesHilos): HiloSeed[] {
  const rnd = mulberry32(opciones.semilla ?? 42)
  const ahora = new Date(opciones.ahora).getTime()
  const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]

  return opciones.obligaciones.map((o, i) => {
    const ctx: ContextoGuion = {
      nombre: o.deudorNombre.split(' ')[0],
      empresa: opciones.empresa,
      credito: o.numeroCredito,
      saldo: cop(o.saldoTotal),
      cuota: cop(Math.round(o.saldoTotal / 2)),
      abono: cop(Math.max(50_000, Math.round(o.saldoTotal * 0.2))),
      diasMora: Math.max(0, o.diasMora),
    }

    // El largo se reparte a propósito en los tres casos que se ven distinto en
    // pantalla: el de dos mensajes, el normal, y el que obliga a hacer scroll.
    // Uno de cada tipo queda garantizado por el índice, no por el azar.
    const corto = i % 10 === 0
    const largo = !corto && i % 7 === 0
    const guion = corto ? GUIONES[0] : GUIONES[i % GUIONES.length]

    // Los hilos largos son largos por la razón por la que lo son en la realidad:
    // meses de intentos sin respuesta antes de que el deudor conteste una vez.
    const objetivo = largo ? 22 + Math.floor(rnd() * 14) : corto ? 0 : 3 + Math.floor(rnd() * 10)

    // Primero la presentación, después los meses de cadencia, y al final el arco
    // donde el deudor por fin contesta algo que decide el caso.
    const turnos: Turno[] = [APERTURA]
    while (turnos.length + guion.turnos.length < objetivo) {
      const intentos = 1 + Math.floor(rnd() * 3)
      for (let k = 0; k < intentos; k++) {
        turnos.push({ de: 'agente', texto: elegir(INTENTOS), intento: true })
      }
      // A veces contesta algo que no resuelve nada y la gestión sigue. Sin esto
      // el hilo largo sería un monólogo de treinta mensajes.
      if (rnd() < 0.45) {
        const ronda = elegir(RONDAS)
        turnos.push({ de: 'deudor', texto: () => ronda.deudor })
        turnos.push({ de: 'agente', texto: ronda.agente })
      }
    }
    turnos.push(...guion.turnos)

    // El hilo termina hace entre 5 minutos y 6 días. Eso da una bandeja con
    // mezcla de "recién" y "hace rato", que es como se ve una real.
    //
    // Un tercio termina dentro de las últimas horas a propósito: son los hilos
    // con la **ventana de servicio abierta**, los únicos donde el redactor deja
    // escribir texto libre. Dejado al azar sobre seis días quedaban dos de
    // cuarenta, y la mitad de la pantalla no se podía ni mirar mientras se
    // construye.
    const finEn = ultimoMomentoPermitido(
      i % 3 === 0
        ? ahora - Math.floor(rnd() * 18 * 60) * MINUTO - 5 * MINUTO
        : ahora - Math.floor(rnd() * 6 * 24 * 60) * MINUTO - 5 * MINUTO,
    )

    // Los huecos se sortean primero y se acumulan hacia adelante.
    //
    // Antes cada instante se calculaba como `finEn - m * (7 + rnd() * 90)`, con
    // el multiplicador sorteado por mensaje: el turno 2 con factor 90 caía más
    // viejo que el turno 3 con factor 7. Los instantes no quedaban ordenados y
    // el `sort` posterior los reacomodaba, desarmando la alternancia que el
    // guion acababa de armar.
    //
    // Un intento de cadencia se separa en días del siguiente, porque eso es lo
    // que la Ley 2300 permite; dentro de una conversación viva los turnos se
    // separan en minutos. Esa diferencia es lo que hace que unos hilos tengan la
    // ventana de 24 h abierta y otros no.
    const huecos = turnos
      .slice(1)
      .map((t, k) =>
        turnos[k].intento ? (3 + Math.floor(rnd() * 7)) * DIA : (7 + Math.floor(rnd() * 90)) * MINUTO,
      )

    // Uno de cada ocho intentos de cadencia fue bloqueado por la ley. Son parte
    // del hilo y son la evidencia; esconderlos haría parecer que nunca se
    // intentó. Solo pasa en los intentos: dentro de una conversación viva, con
    // la ventana de 24 h abierta, el guard no tiene por qué bloquear.
    //
    // La apertura nunca se bloquea. Un intento que el guard para se reprograma
    // —`planificarEnvio` lo mueve al siguiente momento legal—, así que un hilo
    // que arranca con un bloqueo y nunca se presenta es un estado que la
    // cadencia no produce. Y deja al deudor contestando preguntas que en
    // pantalla nadie le hizo.
    const bloqueados = turnos.map((t, k) => k > 0 && t.intento === true && rnd() < 1 / 8)

    // El deudor escribe cuando quiere; el agente, solo cuando la ley lo deja.
    //
    // Se coloca **desde el final hacia atrás**, y no al revés. Colocando hacia
    // adelante, cada salto a un momento legal empuja el hilo y el cierre termina
    // más tarde de lo previsto; corregirlo obliga a retroceder el arranque y
    // volver a colocar, y el hilo acaba uno o dos días antes de donde debía.
    // Con la bandeja eso se ve enseguida: no queda un solo hilo con la ventana
    // de 24 h abierta.
    //
    // Anclando el final, `finEn` se respeta exacto y los saltos solo mueven al
    // pasado, que es donde sobra lugar.
    const instantes: number[] = new Array(turnos.length)
    let instante = finEn
    for (let k = turnos.length - 1; k >= 0; k--) {
      const efectivo =
        turnos[k].de === 'deudor'
          ? instante
          : bloqueados[k]
            ? anteriorMomentoProhibido(instante)
            : ultimoMomentoPermitido(instante)
      instantes[k] = efectivo
      instante = efectivo - (huecos[k - 1] ?? 0)
    }

    const mensajes: MensajeSeed[] = instantes.map((ms, k) => {
      const entrante = turnos[k].de === 'deudor'
      return {
        ocurridoEn: new Date(ms).toISOString(),
        direccion: entrante ? 'entrante' : 'saliente',
        cuerpo: bloqueados[k] ? '' : turnos[k].texto(ctx),
        resultado: bloqueados[k]
          ? 'bloqueado'
          : entrante
            ? 'entregado'
            : elegir(['entregado', 'leido'] as const),
        motivoBloqueo: bloqueados[k] ? motivoDelBloqueo(ms, rnd) : null,
      }
    })

    // Un caso que un humano tomó siempre tiene dueño: dejarlo pausado y sin
    // asignar es el estado del que nadie se hace cargo.
    const asignadaA = guion.pausa
      ? opciones.usuarios[i % opciones.usuarios.length]
      : i % 4 === 3
        ? null
        : opciones.usuarios[i % opciones.usuarios.length]

    return {
      deudorId: o.deudorId,
      obligacionId: o.id,
      guion: guion.id,
      mensajes,
      notas: guion.nota
        ? [
            {
              // Anclada al hilo, no a `finEn`: cuando los saltos a momentos
              // legales corren el hilo hacia atrás, una nota fija quedaría
              // fechada después del último mensaje que comenta.
              cuerpo: guion.nota,
              usuarioId: asignadaA ?? opciones.usuarios[0],
              ocurridoEn: new Date(
                new Date(mensajes.at(-1)?.ocurridoEn ?? finEn).getTime() - 3 * MINUTO,
              ).toISOString(),
            },
          ]
        : [],
      etiquetas: guion.etiqueta ? [guion.etiqueta] : [],
      agentePausado: guion.pausa,
      motivoPausa: guion.pausa ? 'Lo estoy manejando yo' : null,
      asignadaA,
      marca: guion.marca,
      // Sin leer para todos menos para quien lo tiene asignado, salvo un tercio
      // que queda sin leer incluso para su dueño: es el caso que duele y el que
      // la bandeja tiene que hacer visible.
      sinLeerPara:
        i % 3 === 1 ? opciones.usuarios : opciones.usuarios.filter((u) => u !== asignadaA),
    }
  })
}
