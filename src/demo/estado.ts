import type { Acuerdo, Contacto, Deudor, Obligacion, Pago } from '@/domain/types'
import { enBogota, sumarDias } from '@/compliance/reloj-bogota'
import { calcularTramo } from '@/cadence/planificador'
import { generarCartera, type CarteraDemo } from './seed'

/**
 * Estado de la demo en vivo, en memoria del proceso.
 *
 * Deliberadamente **no** es una base de datos. La demo tiene que arrancar en un
 * `pnpm dev` sin migraciones y quedar reproducible: mismo seed, mismas cifras,
 * misma conversación en cada ensayo. Cuando entre el primer cliente real esto se
 * reemplaza por la implementación de `RepositorioWebhook`
 * (`src/channels/procesador-webhook.ts:21`), que es el puerto que ya existe.
 *
 * Vive sobre `globalThis` porque el hot-reload de Next recarga los módulos y sin
 * eso la conversación se borraría cada vez que se toca un archivo — justo en
 * mitad de un ensayo.
 */

/** Cuántos deudores tiene la cartera de la demo. Suficiente para que el panel se vea poblado. */
const TAMANO_CARTERA = 40

/**
 * El deudor que se muestra en la reunión. No se sortea: sus cifras están
 * elegidas para que la negociación tenga sentido en pantalla.
 *
 * 43 días de mora lo pone en tramo `media`, que es el único tramo donde el
 * cliente demo autoriza descuento (10%) y cuotas (hasta 4). En temprana no
 * habría nada que negociar y la demo se quedaría sin su mejor momento.
 */
const PROTAGONISTA = {
  nombre: 'Jorge Ospina',
  documento: '1024587963',
  telefono: '+573001234567',
  numeroCredito: 'CR-04471',
  capital: 1_760_000,
  interesMora: 80_000,
  diasMora: 43,
} as const

export type QuienHabla = 'deudor' | 'agente' | 'humano' | 'sistema'

/** Un mensaje tal como se pinta en el teléfono. */
export interface MensajeDemo {
  id: string
  de: QuienHabla
  texto: string
  /** ISO 8601. */
  ts: string
  /** Nombre del humano que respondió, cuando `de === 'humano'`. */
  autor?: string
}

/**
 * Un paso del razonamiento del agente, para el panel de contexto.
 *
 * Es lo que hace que la demo explique el producto en vez de solo mostrarlo: el
 * cliente ve *que* consultó la cartera, no solo el resultado.
 */
export interface PasoTraza {
  id: string
  /** `consultarCartera`, `guard`, `proponerAcuerdo`… */
  herramienta: string
  /** Una línea, en lenguaje de negocio. */
  detalle: string
  ts: string
  estado: 'corriendo' | 'ok' | 'bloqueado'
}

/** Los mismos estados que usa la animación de la landing (`landing/demo/guion.ts:32`). */
export type EstadoCaso =
  | 'en_cola'
  | 'contactado'
  | 'negociando'
  | 'espera'
  | 'acuerdo'
  | 'pagado'
  | 'humano'

export interface Conversacion {
  telefono: string
  deudorId: string
  obligacionId: string
  mensajes: MensajeDemo[]
  traza: PasoTraza[]
  estadoCaso: EstadoCaso
  /** ISO 8601 del último entrante. Abre la ventana de servicio de 24 h. */
  ventanaAbiertaEn: string | null
  acuerdo: Acuerdo | null
  pago: Pago | null
  /**
   * Rastro del espejo en Chatwoot. Null mientras no se haya espejado.
   *
   * `espejados` es cuántos mensajes ya se subieron: el espejo se llama en cada
   * turno y sin ese contador duplicaría toda la conversación cada vez.
   */
  chatwoot: {
    /** `source_id` del contacto, el que usa la API pública. */
    fuenteId: string
    /** Id numérico del contacto, el que usa la API de aplicación. */
    contactoId: number
    conversacionId: number
    espejados: number
    etiquetas: string[]
  } | null
  /** Se incrementa en cada cambio. El teléfono lo usa para no repintar de más. */
  version: number
}

export interface EstadoDemo {
  cartera: CarteraDemo
  fechaCorte: string
  conversaciones: Map<string, Conversacion>
  /** Log de auditoría: todo intento de contacto, incluidos los bloqueados. */
  contactos: Contacto[]
  /** Pagos por referencia (`COB-{obligacionId}-{nonce}`). */
  pagos: Map<string, Pago>
  secuencia: number
}

interface ConGlobal {
  __ponoxDemo?: EstadoDemo
}

export function estadoDemo(): EstadoDemo {
  const g = globalThis as unknown as ConGlobal
  g.__ponoxDemo ??= crear()
  return g.__ponoxDemo
}

/** Vuelve la demo a cero. La pantalla lo llama antes de cada ensayo. */
export function reiniciarDemo(): EstadoDemo {
  const g = globalThis as unknown as ConGlobal
  g.__ponoxDemo = crear()
  return g.__ponoxDemo
}

function crear(): EstadoDemo {
  const fechaCorte = enBogota(new Date()).fecha
  const cartera = generarCartera({ cantidad: TAMANO_CARTERA, fechaCorte, semilla: 42 })
  inyectarProtagonista(cartera, fechaCorte)

  return {
    cartera,
    fechaCorte,
    conversaciones: new Map(),
    contactos: [],
    pagos: new Map(),
    secuencia: 0,
  }
}

/**
 * Reemplaza el primer deudor sorteado por el protagonista.
 *
 * Se reemplaza en vez de agregarse para que el total de la cartera siga siendo
 * `TAMANO_CARTERA` y los números del panel cuadren.
 */
function inyectarProtagonista(cartera: CarteraDemo, fechaCorte: string): void {
  const clienteId = cartera.cliente.id
  const deudorId = `deu_${PROTAGONISTA.documento}`
  const obligacionId = `obl_${PROTAGONISTA.documento}`

  const deudor: Deudor = {
    id: deudorId,
    clienteId,
    tipoDocumento: 'CC',
    documento: PROTAGONISTA.documento,
    nombre: PROTAGONISTA.nombre,
    telefonos: [PROTAGONISTA.telefono],
    email: null,
    rol: 'titular',
    consentimiento: {
      otorgado: true,
      fuente: 'pagare',
      fecha: '2025-11-04',
      revocadoEn: null,
    },
    preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
  }

  const obligacion: Obligacion = {
    id: obligacionId,
    clienteId,
    deudorId,
    numeroCredito: PROTAGONISTA.numeroCredito,
    capital: PROTAGONISTA.capital,
    interesMora: PROTAGONISTA.interesMora,
    saldoTotal: PROTAGONISTA.capital + PROTAGONISTA.interesMora,
    fechaVencimiento: sumarDias(fechaCorte, -PROTAGONISTA.diasMora),
    diasMora: PROTAGONISTA.diasMora,
    tramo: calcularTramo(PROTAGONISTA.diasMora),
    estado: 'en_mora',
  }

  cartera.deudores[0] = deudor
  cartera.obligaciones[0] = obligacion
}

// ————— Consultas —————

/** El deudor de la demo, para precargar la pantalla sin pedirle nada al usuario. */
export function telefonoProtagonista(): string {
  return PROTAGONISTA.telefono
}

/**
 * Cruza un celular contra la cartera. Es exactamente el paso "identifica quién
 * escribe" del flujograma.
 */
export function buscarPorTelefono(
  estado: EstadoDemo,
  telefono: string,
): { deudor: Deudor; obligacion: Obligacion } | null {
  const normalizado = telefono.replace(/\s/g, '')
  const deudor = estado.cartera.deudores.find((d) => d.telefonos.includes(normalizado))
  if (!deudor) return null

  // Una obligación abierta por deudor en la demo. Con multi-obligación habría
  // que elegir cuál se cobra, y esa decisión no es del agente.
  //
  // La pagada no se descarta: se prefiere una abierta si la hay, y si no queda
  // ninguna se devuelve la última igual. Descartarla hacía que el expediente
  // desapareciera justo cuando el deudor termina de pagar, que es exactamente
  // el momento que la demo quiere mostrar y el que el asesor quiere revisar.
  const suyas = estado.cartera.obligaciones.filter((o) => o.deudorId === deudor.id)
  const obligacion = suyas.find((o) => o.estado !== 'pagada') ?? suyas.at(-1)
  if (!obligacion) return null

  return { deudor, obligacion }
}

export function obligacionPorId(estado: EstadoDemo, id: string): Obligacion | null {
  return estado.cartera.obligaciones.find((o) => o.id === id) ?? null
}

export function deudorPorId(estado: EstadoDemo, id: string): Deudor | null {
  return estado.cartera.deudores.find((d) => d.id === id) ?? null
}

/** Contactos previos de un deudor. Alimenta el cupo semanal del guard. */
export function contactosDelDeudor(estado: EstadoDemo, deudorId: string): Contacto[] {
  return estado.contactos.filter((c) => c.deudorId === deudorId)
}

// ————— Mutaciones —————

export function abrirConversacion(
  estado: EstadoDemo,
  telefono: string,
  deudorId: string,
  obligacionId: string,
): Conversacion {
  const existente = estado.conversaciones.get(telefono)
  if (existente) return existente

  const nueva: Conversacion = {
    telefono,
    deudorId,
    obligacionId,
    mensajes: [],
    traza: [],
    estadoCaso: 'en_cola',
    ventanaAbiertaEn: null,
    acuerdo: null,
    pago: null,
    chatwoot: null,
    version: 0,
  }
  estado.conversaciones.set(telefono, nueva)
  return nueva
}

export function agregarMensaje(
  estado: EstadoDemo,
  conversacion: Conversacion,
  mensaje: Omit<MensajeDemo, 'id' | 'ts'> & { ts?: string },
): MensajeDemo {
  estado.secuencia += 1
  const completo: MensajeDemo = {
    id: `msg_${estado.secuencia}`,
    ts: mensaje.ts ?? new Date().toISOString(),
    de: mensaje.de,
    texto: mensaje.texto,
    ...(mensaje.autor ? { autor: mensaje.autor } : {}),
  }
  conversacion.mensajes.push(completo)
  conversacion.version += 1
  return completo
}

/**
 * Agrega el paso solo si dice algo distinto al último de su misma herramienta.
 *
 * `ventanaServicio` y `guardLey2300` corren en cada turno y casi siempre dicen
 * lo mismo. Repetirlos tres veces convierte la traza —que es la prueba de
 * compliance— en ruido, y lo que importa (la consulta a cartera, el acuerdo, el
 * link) se pierde entre líneas iguales.
 */
export function agregarPasoSiCambia(
  estado: EstadoDemo,
  conversacion: Conversacion,
  paso: Omit<PasoTraza, 'id' | 'ts'>,
): PasoTraza | null {
  const ultimoIgual = [...conversacion.traza]
    .reverse()
    .find((p) => p.herramienta === paso.herramienta)

  if (ultimoIgual && ultimoIgual.detalle === paso.detalle && ultimoIgual.estado === paso.estado) {
    return null
  }
  return agregarPaso(estado, conversacion, paso)
}

export function agregarPaso(
  estado: EstadoDemo,
  conversacion: Conversacion,
  paso: Omit<PasoTraza, 'id' | 'ts'>,
): PasoTraza {
  estado.secuencia += 1
  const completo: PasoTraza = { id: `paso_${estado.secuencia}`, ts: new Date().toISOString(), ...paso }
  conversacion.traza.push(completo)
  conversacion.version += 1
  return completo
}

/**
 * Registra un intento de contacto en el log de auditoría.
 *
 * Se llama **también** cuando el guard bloquea. Ese registro es el entregable de
 * compliance: prueba que el sistema decidió no escribir, y por qué.
 */
export function registrarContacto(
  estado: EstadoDemo,
  contacto: Omit<Contacto, 'id'>,
): Contacto {
  estado.secuencia += 1
  const completo: Contacto = { id: `ctc_${estado.secuencia}`, ...contacto }
  estado.contactos.push(completo)
  return completo
}

export function siguienteNonce(estado: EstadoDemo): string {
  estado.secuencia += 1
  return `d${estado.secuencia.toString(36)}${estado.fechaCorte.slice(8)}`
}
