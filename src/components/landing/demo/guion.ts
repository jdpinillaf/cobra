/**
 * El guion de la demo: dos actos sobre una sola lista plana de eventos.
 *
 * Acto 1 — se configura el agente: se le escribe la instrucción, se le arma el
 * plan y se le conectan las herramientas.
 * Acto 2 — el agente atiende una cola de casos y se ve el progreso.
 *
 * La fase **se deriva** del último evento visible (`faseDe`), nunca se guarda
 * en estado ni se marca con un índice de corte: una constante de corte se
 * desincroniza del array el día que alguien inserta un evento en la mitad.
 */

export type Fase = 'configuracion' | 'operacion'

// --- Acto 1: configuración ---

export interface Herramienta {
  readonly id: 'whatsapp' | 'pagos' | 'cartera' | 'agenda'
  readonly nombre: string
  /** El dato concreto que prueba que la conexión es real y no un ícono. */
  readonly detalle: string
}

export interface Paso {
  readonly orden: number
  readonly cuando: string
  readonly texto: string
}

// --- Acto 2: operación ---

export type EstadoCaso =
  | 'en_cola'
  | 'contactado'
  | 'negociando'
  | 'espera'
  | 'acuerdo'
  | 'pagado'
  | 'humano'

export interface Caso {
  readonly id: string
  readonly nombre: string
  readonly saldoCop: number
  readonly diasMora: number
}

export type Evento =
  | { readonly tipo: 'escribe'; readonly espera: number; readonly texto: string }
  | { readonly tipo: 'paso'; readonly espera: number; readonly paso: Paso }
  | { readonly tipo: 'conecta'; readonly espera: number; readonly herramienta: Herramienta }
  | { readonly tipo: 'despliega'; readonly espera: number; readonly texto: string }
  | { readonly tipo: 'cola'; readonly espera: number; readonly caso: Caso }
  | {
      readonly tipo: 'avance'
      readonly espera: number
      readonly caso: string
      readonly estado: EstadoCaso
      readonly paso?: number
      readonly nota?: string
    }
  | { readonly tipo: 'abre'; readonly espera: number; readonly caso: string }
  | {
      readonly tipo: 'mensaje'
      readonly espera: number
      readonly de: 'agente' | 'cliente'
      readonly hora: string
      readonly texto: string
    }
  | { readonly tipo: 'escribiendo'; readonly espera: number }
  | {
      readonly tipo: 'link'
      readonly espera: number
      readonly hora: string
      readonly referencia: string
      readonly montoCop: number
      readonly texto: string
    }
  | {
      readonly tipo: 'pago'
      readonly espera: number
      readonly caso: string
      readonly montoCop: number
      readonly referencia: string
    }

/** Eventos que se pintan dentro del hilo de conversación del caso abierto. */
export type EventoConversacion = Extract<Evento, { tipo: 'mensaje' | 'escribiendo' | 'link' }>

/**
 * Exhaustivo a propósito: si mañana se agrega un tipo de evento, TypeScript
 * obliga a decidir a qué acto pertenece.
 */
export function faseDe(e: Evento): Fase {
  switch (e.tipo) {
    case 'escribe':
    case 'paso':
    case 'conecta':
    case 'despliega':
      return 'configuracion'
    case 'cola':
    case 'avance':
    case 'abre':
    case 'mensaje':
    case 'escribiendo':
    case 'link':
    case 'pago':
      return 'operacion'
  }
}

// --- Ritmo de tecleo ---

/**
 * A 11 ms por carácter se lee como alguien que escribe rápido y seguro. Se
 * probó a 16 y el acto de configuración se sentía como espera, no como
 * animación: nadie mira teclear, mira lo que quedó escrito.
 *
 * Las pausas de puntuación se quedan —son lo que separa "alguien escribiendo"
 * de "un banner de marquesina"— pero recortadas.
 */
export const MS_POR_CARACTER = 11
const MS_TRAS_PUNTO = 90
const MS_TRAS_COMA = 45
const PAUSA_TRAS_LINEA = 170

/**
 * Determinista: depende solo del texto. La espera del evento la calcula esta
 * función y el bucle de tecleo avanza a `MS_POR_CARACTER` plano, así que el
 * tecleo **siempre** termina antes que el timer y la línea no se puede cortar.
 */
export function duracionEscritura(texto: string): number {
  let ms = 0
  for (const c of texto) {
    ms += MS_POR_CARACTER
    if (c === '.' || c === ':') ms += MS_TRAS_PUNTO
    else if (c === ',') ms += MS_TRAS_COMA
  }
  return ms
}

const escribe = (texto: string): Evento => ({
  tipo: 'escribe',
  texto,
  espera: duracionEscritura(texto) + PAUSA_TRAS_LINEA,
})

// --- Los datos del guion ---

export const CLIENTE = { empresa: 'Crediya', operadora: 'Carolina' } as const

export const CADENCIA: readonly Paso[] = [
  { orden: 1, cuando: 'Día 1', texto: 'recordatorio con el saldo y el link' },
  { orden: 2, cuando: 'Día 4', texto: 'si no responde, propone acuerdo' },
  { orden: 3, cuando: 'Día 9', texto: 'última oferta y se detiene' },
  { orden: 4, cuando: 'Al pagar', texto: 'confirma, cierra y no vuelve a escribir' },
]

export const HERRAMIENTAS: readonly Herramienta[] = [
  { id: 'whatsapp', nombre: 'WhatsApp Business', detalle: `número de ${CLIENTE.empresa} · +57 601 744 ••••` },
  { id: 'pagos', nombre: 'Pasarela de pagos', detalle: `cuenta de ${CLIENTE.empresa} · la plata no pasa por nosotros` },
  { id: 'cartera', nombre: 'Cartera', detalle: '1.240 obligaciones · Excel o CRM' },
  { id: 'agenda', nombre: 'Agenda', detalle: `para pasarle el caso a ${CLIENTE.operadora}` },
]

/**
 * Cuatro líneas, no cinco: se cayó la del tono —"escribes por WhatsApp,
 * tuteando"— porque el chat de la fase 2 ya lo demuestra, y decir en texto lo
 * que después se ve es justo lo que hacía largo este acto.
 *
 * Ninguna línea menciona una norma. Todo lo que acota al agente lo fija el
 * cliente: cuotas, descuento, frecuencia y a quién escalar. Así el acto 1
 * generaliza —es cómo se construye cualquier agente— y el argumento de que el
 * agente se contiene solo se conserva entero.
 */
const CONFIGURACION: readonly Evento[] = [
  escribe(`Eres el agente de cobranza de ${CLIENTE.empresa}.`),
  escribe('Puedes ofrecer hasta 2 cuotas. Sin descuento.'),
  escribe('Un contacto por semana. Nunca más.'),
  escribe(`Lo que se salga de eso, va para ${CLIENTE.operadora}.`),
  ...CADENCIA.map((paso): Evento => ({ tipo: 'paso', espera: 360, paso })),
  ...HERRAMIENTAS.map((herramienta): Evento => ({ tipo: 'conecta', espera: 400, herramienta })),
  { tipo: 'despliega', espera: 900, texto: 'Agente desplegado' },
]

export const CASOS: readonly Caso[] = [
  { id: 'CR-00412', nombre: 'Ana Ruiz', saldoCop: 1_245_000, diasMora: 22 },
  { id: 'CR-00518', nombre: 'Jorge Peña', saldoCop: 480_000, diasMora: 9 },
  { id: 'CR-00473', nombre: 'Marta Salas', saldoCop: 2_310_000, diasMora: 41 },
  { id: 'CR-00629', nombre: 'Iván Torres', saldoCop: 760_000, diasMora: 5 },
  { id: 'CR-00551', nombre: 'Luz Ramírez', saldoCop: 1_020_000, diasMora: 63 },
]

const CUOTA_COP = 622_500
const REFERENCIA = 'CR-00412-2608'

/**
 * El hilo de un caso, con avances de **otros** casos intercalados. Sin eso
 * esto es una conversación con marco de app; con eso es una cola.
 *
 * Los tiempos van un 35 % por debajo de la primera versión. **No se cayó ningún
 * beat**: entran los mismos cinco casos, la misma negociación, el mismo link y
 * los mismos dos desvíos. Lo que se recortó son las esperas entre uno y otro,
 * que es donde la demo se sentía lenta. Las burbujas se quedan en pantalla, así
 * que el tiempo de lectura no es la espera de cada evento sino lo que queda
 * visible después.
 */
const OPERACION: readonly Evento[] = [
  ...CASOS.map((caso): Evento => ({ tipo: 'cola', espera: 230, caso })),
  { tipo: 'abre', espera: 290, caso: 'CR-00412' },
  { tipo: 'avance', espera: 320, caso: 'CR-00412', estado: 'contactado', paso: 1 },
  {
    tipo: 'mensaje',
    espera: 580,
    de: 'agente',
    hora: '09:12',
    texto: `Hola Ana, te escribo de ${CLIENTE.empresa}. Tu saldo hoy es $1.245.000. ¿Lo vemos?`,
  },
  { tipo: 'escribiendo', espera: 780 },
  {
    tipo: 'mensaje',
    espera: 580,
    de: 'cliente',
    hora: '09:14',
    texto: 'No tengo cómo pagar todo de una.',
  },
  { tipo: 'avance', espera: 390, caso: 'CR-00412', estado: 'negociando' },
  { tipo: 'avance', espera: 460, caso: 'CR-00518', estado: 'contactado', paso: 1 },
  {
    tipo: 'avance',
    espera: 580,
    caso: 'CR-00629',
    estado: 'espera',
    nota: `fuera de la ventana que fijó ${CLIENTE.empresa} · reprogramado 07:00`,
  },
  {
    tipo: 'mensaje',
    espera: 720,
    de: 'agente',
    hora: '09:15',
    texto: 'Puedo dividirlo en 2 cuotas de $622.500, sin recargo. La primera hoy.',
  },
  { tipo: 'escribiendo', espera: 720 },
  { tipo: 'mensaje', espera: 520, de: 'cliente', hora: '09:16', texto: 'Sí, así sí puedo.' },
  { tipo: 'avance', espera: 390, caso: 'CR-00412', estado: 'acuerdo', paso: 2 },
  {
    tipo: 'link',
    espera: 910,
    hora: '09:16',
    referencia: REFERENCIA,
    montoCop: CUOTA_COP,
    texto: 'Listo. Este es el link de la primera cuota:',
  },
  {
    tipo: 'avance',
    espera: 580,
    caso: 'CR-00473',
    estado: 'humano',
    nota: `pidió condonación · fuera de los límites, va para ${CLIENTE.operadora}`,
  },
  { tipo: 'avance', espera: 460, caso: 'CR-00518', estado: 'negociando' },
  { tipo: 'pago', espera: 780, caso: 'CR-00412', montoCop: CUOTA_COP, referencia: REFERENCIA },
  {
    tipo: 'mensaje',
    espera: 650,
    de: 'agente',
    hora: '09:21',
    texto: 'Recibido. Te queda una cuota para el 26. No te vuelvo a escribir hasta entonces.',
  },
  { tipo: 'avance', espera: 460, caso: 'CR-00412', estado: 'pagado', paso: 3 },
  { tipo: 'avance', espera: 520, caso: 'CR-00551', estado: 'contactado', paso: 1 },
]

export const GUION: readonly Evento[] = [...CONFIGURACION, ...OPERACION]

export const DURACION_MS = GUION.reduce((suma, e) => suma + e.espera, 0)

// --- El reductor ---

export interface FilaCaso {
  readonly caso: Caso
  readonly estado: EstadoCaso
  readonly paso: number
  readonly nota?: string
}

export interface Tablero {
  readonly instruccion: readonly string[]
  readonly cadencia: readonly Paso[]
  readonly herramientas: readonly Herramienta[]
  readonly desplegando: boolean
  readonly casos: readonly FilaCaso[]
  readonly abierto: string | null
  readonly conversacion: readonly EventoConversacion[]
  readonly recaudadoCop: number
  readonly mensajes: { readonly salientes: number; readonly entrantes: number }
}

/**
 * Función pura: los eventos visibles entran, el estado de la pantalla sale.
 *
 * Las dos vistas son componentes tontos que reciben esto. Es lo único de la
 * demo que se puede testear de verdad, y esa es la razón de que exista.
 */
export function reducir(eventos: readonly Evento[]): Tablero {
  const instruccion: string[] = []
  const cadencia: Paso[] = []
  const herramientas: Herramienta[] = []
  const casos: FilaCaso[] = []
  const conversacion: EventoConversacion[] = []

  let desplegando = false
  let abierto: string | null = null
  let recaudadoCop = 0
  let salientes = 0
  let entrantes = 0

  for (const e of eventos) {
    switch (e.tipo) {
      case 'escribe':
        instruccion.push(e.texto)
        break
      case 'paso':
        cadencia.push(e.paso)
        break
      case 'conecta':
        herramientas.push(e.herramienta)
        break
      case 'despliega':
        desplegando = true
        break
      case 'cola':
        casos.push({ caso: e.caso, estado: 'en_cola', paso: 0 })
        break
      case 'avance': {
        const i = casos.findIndex((f) => f.caso.id === e.caso)
        if (i >= 0) {
          casos[i] = {
            ...casos[i],
            estado: e.estado,
            paso: e.paso ?? casos[i].paso,
            nota: e.nota ?? casos[i].nota,
          }
        }
        break
      }
      case 'abre':
        abierto = e.caso
        break
      case 'mensaje':
        conversacion.push(e)
        if (e.de === 'agente') salientes += 1
        else entrantes += 1
        break
      case 'link':
        conversacion.push(e)
        salientes += 1
        break
      case 'escribiendo':
        conversacion.push(e)
        break
      case 'pago':
        recaudadoCop += e.montoCop
        break
    }
  }

  /*
   * El indicador de "escribiendo" solo tiene sentido si nada vino después.
   * Igual que en la demo anterior: si se queda, se lee como un mensaje que
   * nunca llegó.
   */
  const hilo = conversacion.filter(
    (e, i) => e.tipo !== 'escribiendo' || i === conversacion.length - 1,
  )

  return {
    instruccion,
    cadencia,
    herramientas,
    desplegando,
    casos,
    abierto,
    conversacion: hilo,
    recaudadoCop,
    mensajes: { salientes, entrantes },
  }
}
