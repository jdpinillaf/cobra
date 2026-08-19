import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CategoriaPlantilla, ResultadoEnvio } from '@/domain/types'
import type { CategoriaFacturable } from './tarifas'

/**
 * Webhooks de WhatsApp Cloud API.
 *
 * Todo lo que se puede probar sin red vive aquí como función pura, igual que en
 * `src/payments/wompi.ts`: la ruta de Next se limita a leer el cuerpo crudo,
 * verificar la firma y delegar. Un webhook que solo se puede probar levantando
 * el servidor termina sin probarse.
 *
 * Este archivo es la mitad que faltaba del canal. Sin él, un mensaje enviado se
 * queda en `encolado` para siempre, nadie se entera de que el deudor respondió,
 * y un "BAJA" no revoca nada.
 */

// --- Verificación (GET) ---

export interface ParametrosVerificacion {
  'hub.mode'?: string | null
  'hub.verify_token'?: string | null
  'hub.challenge'?: string | null
}

/**
 * Handshake de suscripción. Meta llama una vez con un token compartido y espera
 * el `challenge` de vuelta en texto plano.
 *
 * Devuelve `null` si no cuadra, y el llamador responde 403: contestar el
 * challenge sin validar el token dejaría que cualquiera confirme la suscripción.
 */
export function responderVerificacion(
  params: ParametrosVerificacion,
  tokenEsperado: string,
): string | null {
  if (params['hub.mode'] !== 'subscribe') return null
  if (!params['hub.verify_token'] || !params['hub.challenge']) return null
  if (!comparacionSegura(params['hub.verify_token'], tokenEsperado)) return null
  return params['hub.challenge']
}

// --- Firma (POST) ---

/**
 * Valida `X-Hub-Signature-256`: `sha256=` + HMAC-SHA256 del **cuerpo crudo** con
 * el App Secret.
 *
 * Tiene que ser el cuerpo tal como llegó. Si se re-serializa el JSON parseado,
 * cualquier diferencia de orden de claves o de escape produce una firma
 * distinta y todos los webhooks legítimos se rechazan.
 *
 * Sin esta validación, quien conozca la URL puede declarar entregado un mensaje
 * que nunca salió, marcar como leído lo que nadie leyó, o inyectar un "BAJA"
 * falso y apagarle la cadencia a un deudor moroso.
 */
export function verificarFirmaMeta(
  cuerpoCrudo: string,
  cabecera: string | null | undefined,
  appSecret: string,
): boolean {
  if (!cabecera?.startsWith('sha256=')) return false
  const recibida = cabecera.slice('sha256='.length)
  const calculada = createHmac('sha256', appSecret).update(cuerpoCrudo, 'utf8').digest('hex')
  return comparacionSegura(calculada, recibida)
}

/** Comparación en tiempo constante, para no filtrar la firma por temporización. */
function comparacionSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// --- Payload ---

/**
 * Meta reporta el estado de forma asíncrona y en su propio vocabulario. Se
 * traduce al enum del dominio; lo que no se reconozca se ignora en vez de
 * inventar un estado.
 */
const ESTADOS_META: Record<string, ResultadoEnvio> = {
  accepted: 'encolado',
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  failed: 'fallido',
  deleted: 'fallido',
}

export interface CambioEstado {
  /** `wamid`. Es lo que amarra este evento con el `Contacto` que lo originó. */
  idProveedor: string
  /**
   * Número que recibió el evento, y por lo tanto de qué cliente es.
   *
   * Va por evento y no por payload porque Meta agrupa en una sola entrega los
   * eventos de todos los números de una misma WABA: un lote puede traer dos
   * clientes mezclados. `null` si el payload no trae `metadata`.
   */
  phoneNumberId: string | null
  estado: ResultadoEnvio
  ocurrioEn: string
  /** Categoría con la que Meta realmente facturó, que puede no ser la que se declaró. */
  categoria: CategoriaFacturable | null
  /** `false` en la ventana de servicio de 24 h. Es el ahorro, confirmado por Meta. */
  facturable: boolean | null
  codigoError: string | null
  error: string | null
}

export interface MensajeEntrante {
  idProveedor: string
  /** Ver `CambioEstado.phoneNumberId`. */
  phoneNumberId: string | null
  /** E.164 **con** `+`. Meta lo manda sin él. */
  deTelefono: string
  cuerpo: string
  tipo: string
  ocurrioEn: string
  nombrePerfil: string | null
}

/**
 * Recorre los `statuses[]` del payload.
 *
 * El campo `pricing` es lo que permite conciliar el costo estimado contra el
 * real: si Meta reclasificó una plantilla de `utility` a `marketing`, aquí se
 * ve, y son 25 veces la diferencia.
 */
export function interpretarEstados(payload: unknown): CambioEstado[] {
  const salida: CambioEstado[] = []

  for (const valor of valoresDeMensajes(payload)) {
    for (const s of arreglo(valor.statuses)) {
      const estado = ESTADOS_META[String(s?.status ?? '')]
      if (!estado || !s?.id) continue

      const primerError = arreglo(s.errors)[0]
      salida.push({
        idProveedor: String(s.id),
        phoneNumberId: valor.metadata?.phone_number_id
          ? String(valor.metadata.phone_number_id)
          : null,
        estado,
        ocurrioEn: desdeUnix(s.timestamp),
        categoria: categoriaFacturable(s.pricing?.category),
        facturable: typeof s.pricing?.billable === 'boolean' ? s.pricing.billable : null,
        codigoError: primerError?.code != null ? String(primerError.code) : null,
        error: primerError?.title ? String(primerError.title) : null,
      })
    }
  }

  return salida
}

/** Recorre los `messages[]` del payload: lo que el deudor respondió. */
export function interpretarEntrantes(payload: unknown): MensajeEntrante[] {
  const salida: MensajeEntrante[] = []

  for (const valor of valoresDeMensajes(payload)) {
    const perfiles = new Map(
      arreglo(valor.contacts).map((c) => [String(c?.wa_id ?? ''), c?.profile?.name ?? null]),
    )

    for (const m of arreglo(valor.messages)) {
      if (!m?.id || !m?.from) continue
      salida.push({
        idProveedor: String(m.id),
        phoneNumberId: valor.metadata?.phone_number_id
          ? String(valor.metadata.phone_number_id)
          : null,
        deTelefono: `+${String(m.from).replace(/^\+/, '')}`,
        cuerpo: cuerpoDelMensaje(m),
        tipo: String(m.type ?? 'desconocido'),
        ocurrioEn: desdeUnix(m.timestamp),
        nombrePerfil: perfiles.get(String(m.from)) ?? null,
      })
    }
  }

  return salida
}

/**
 * Texto legible del mensaje entrante.
 *
 * Un botón de plantilla llega como `button` y no como `text`; leerlo importa
 * porque el opt-out del deudor puede venir por ahí y no escrito a mano.
 */
function cuerpoDelMensaje(m: MensajeCrudo): string {
  if (m.text?.body) return String(m.text.body)
  if (m.button?.text) return String(m.button.text)
  if (m.interactive?.button_reply?.title) return String(m.interactive.button_reply.title)
  if (m.interactive?.list_reply?.title) return String(m.interactive.list_reply.title)
  return ''
}

const CATEGORIAS: ReadonlySet<string> = new Set<CategoriaPlantilla>([
  'utility',
  'marketing',
  'authentication',
])

function categoriaFacturable(cruda: unknown): CategoriaFacturable | null {
  const v = String(cruda ?? '')
  if (CATEGORIAS.has(v)) return v as CategoriaPlantilla
  if (v === 'service') return 'servicio'
  return null
}

/** Meta manda epoch en segundos, como string. */
function desdeUnix(timestamp: unknown): string {
  const segundos = Number(timestamp)
  if (!Number.isFinite(segundos) || segundos <= 0) return new Date(0).toISOString()
  return new Date(segundos * 1000).toISOString()
}

function arreglo<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : []
}

/**
 * Aplana `entry[].changes[].value` quedándose solo con el campo `messages`.
 *
 * Meta manda por el mismo webhook cambios de calidad del número, de plantillas
 * y de la cuenta. Procesarlos como si fueran mensajes produce basura.
 */
/**
 * Los `phone_number_id` presentes en el payload, sin repetir.
 *
 * Sirve para resolver los tenants de una sola consulta antes de procesar nada,
 * en vez de una por mensaje.
 */
export function numerosDelPayload(payload: unknown): string[] {
  const vistos = new Set<string>()
  for (const valor of valoresDeMensajes(payload)) {
    const id = valor.metadata?.phone_number_id
    if (id) vistos.add(String(id))
  }
  return [...vistos]
}

function valoresDeMensajes(payload: unknown): ValorCrudo[] {
  const p = payload as { entry?: Array<{ changes?: Array<{ field?: string; value?: ValorCrudo }> }> }
  const salida: ValorCrudo[] = []
  for (const entry of arreglo(p?.entry)) {
    for (const cambio of arreglo(entry?.changes)) {
      if (cambio?.field !== 'messages' || !cambio.value) continue
      salida.push(cambio.value)
    }
  }
  return salida
}

interface ValorCrudo {
  /** Identifica al número que recibió el evento. Es el discriminador de tenant. */
  metadata?: { phone_number_id?: string; display_phone_number?: string }
  statuses?: EstadoCrudo[]
  messages?: MensajeCrudo[]
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
}

interface EstadoCrudo {
  id?: string
  status?: string
  timestamp?: string
  pricing?: { billable?: boolean; category?: string }
  errors?: Array<{ code?: number | string; title?: string }>
}

interface MensajeCrudo {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
}
