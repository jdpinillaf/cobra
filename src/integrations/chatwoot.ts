import {
  deudorPorId,
  obligacionPorId,
  type Conversacion,
  type EstadoDemo,
  type MensajeDemo,
} from '@/demo/estado'

/**
 * Espejo de la conversación en Chatwoot.
 *
 * Chatwoot es la consola del equipo de cobranza: ahí se ve el hilo, las
 * etiquetas y los datos del deudor al costado, y desde ahí una persona puede
 * tomar la conversación. Pero **no es el bus**: el teléfono de la demo habla
 * directo con nuestra API. El espejo es de un solo sentido y se lanza sin
 * esperarlo (`void espejarEnChatwoot(...)`).
 *
 * Esa decisión es deliberada. Si Chatwoot está lento o caído en mitad de una
 * reunión, la conversación en el teléfono sigue funcionando y nadie se entera.
 * El precio es que el espejo puede quedar atrasado unos segundos, que en una
 * consola de supervisión no le importa a nadie.
 *
 * Sin variables de entorno configuradas, todo esto es un no-op silencioso.
 */

interface ConfigChatwoot {
  url: string
  cuentaId: string
  token: string
  inboxIdentifier: string
}

function config(): ConfigChatwoot | null {
  const url = process.env.CHATWOOT_URL
  const cuentaId = process.env.CHATWOOT_ACCOUNT_ID
  const token = process.env.CHATWOOT_TOKEN
  const inboxIdentifier = process.env.CHATWOOT_INBOX_IDENTIFIER
  if (!url || !cuentaId || !token || !inboxIdentifier) return null
  return { url: url.replace(/\/$/, ''), cuentaId, token, inboxIdentifier }
}

export function chatwootActivo(): boolean {
  return config() !== null
}

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

/** Etiqueta de la conversación según en qué punto va el caso. */
const ETIQUETA_POR_ESTADO: Record<Conversacion['estadoCaso'], string | null> = {
  en_cola: null,
  contactado: 'contactado',
  negociando: 'negociando',
  espera: 'en-espera',
  acuerdo: 'acuerdo-propuesto',
  pagado: 'pagado',
  humano: 'escalado',
}

export async function espejarEnChatwoot(
  estado: EstadoDemo,
  conversacion: Conversacion,
): Promise<void> {
  const cfg = config()
  if (!cfg) return

  try {
    if (!conversacion.chatwoot) {
      conversacion.chatwoot = await crearEnChatwoot(cfg, estado, conversacion)
    }
    const cw = conversacion.chatwoot

    const pendientes = conversacion.mensajes.slice(cw.espejados)
    for (const mensaje of pendientes) {
      await publicar(cfg, cw, mensaje)
      cw.espejados += 1
    }

    const etiqueta = ETIQUETA_POR_ESTADO[conversacion.estadoCaso]
    if (etiqueta && !cw.etiquetas.includes(etiqueta)) {
      cw.etiquetas.push(etiqueta)
      await etiquetar(cfg, cw.conversacionId, cw.etiquetas)
    }

    await actualizarAtributos(cfg, estado, conversacion, cw.contactoId)
  } catch (error) {
    // Nunca propaga: el espejo no puede tumbar la conversación.
    console.error('[chatwoot] falló el espejo:', error)
  }
}

async function crearEnChatwoot(
  cfg: ConfigChatwoot,
  estado: EstadoDemo,
  conversacion: Conversacion,
): Promise<NonNullable<Conversacion['chatwoot']>> {
  const deudor = deudorPorId(estado, conversacion.deudorId)
  const obligacion = obligacionPorId(estado, conversacion.obligacionId)

  const contacto = await publico<{ source_id: string; id: number }>(
    cfg,
    `/public/api/v1/inboxes/${cfg.inboxIdentifier}/contacts`,
    {
      identifier: conversacion.telefono,
      name: deudor?.nombre ?? conversacion.telefono,
      phone_number: conversacion.telefono,
      custom_attributes: atributos(deudor, obligacion),
    },
  )

  const conv = await publico<{ id: number }>(
    cfg,
    `/public/api/v1/inboxes/${cfg.inboxIdentifier}/contacts/${contacto.source_id}/conversations`,
    {},
  )

  return {
    fuenteId: contacto.source_id,
    contactoId: contacto.id,
    conversacionId: conv.id,
    espejados: 0,
    etiquetas: [],
  }
}

/**
 * Un mensaje del deudor entra por la API pública (queda como `incoming`); todo
 * lo demás por la API de aplicación como `outgoing`. La distinción es la que
 * hace que en la consola se vean de lados distintos.
 */
async function publicar(
  cfg: ConfigChatwoot,
  cw: NonNullable<Conversacion['chatwoot']>,
  mensaje: MensajeDemo,
): Promise<void> {
  if (mensaje.de === 'deudor') {
    await publico(
      cfg,
      `/public/api/v1/inboxes/${cfg.inboxIdentifier}/contacts/${cw.fuenteId}/conversations/${cw.conversacionId}/messages`,
      { content: mensaje.texto },
    )
    return
  }

  // Un mensaje que ya vino de Chatwoot (relevo humano) no se devuelve: lo
  // duplicaría en la consola de quien lo acaba de escribir.
  if (mensaje.de === 'humano') return

  await aplicacion(cfg, `/conversations/${cw.conversacionId}/messages`, 'POST', {
    content: mensaje.texto,
    message_type: 'outgoing',
  })
}

async function etiquetar(
  cfg: ConfigChatwoot,
  conversacionId: number,
  etiquetas: string[],
): Promise<void> {
  await aplicacion(cfg, `/conversations/${conversacionId}/labels`, 'POST', { labels: etiquetas })
}

/**
 * Los atributos del contacto son lo que hace que la consola parezca un CRM: el
 * asesor ve saldo, mora y tramo al lado del chat sin abrir otro sistema.
 */
async function actualizarAtributos(
  cfg: ConfigChatwoot,
  estado: EstadoDemo,
  conversacion: Conversacion,
  contactoId: number,
): Promise<void> {
  const deudor = deudorPorId(estado, conversacion.deudorId)
  const obligacion = obligacionPorId(estado, conversacion.obligacionId)
  await aplicacion(cfg, `/contacts/${contactoId}`, 'PUT', {
    custom_attributes: atributos(deudor, obligacion),
  })
}

function atributos(
  deudor: ReturnType<typeof deudorPorId>,
  obligacion: ReturnType<typeof obligacionPorId>,
): Record<string, string> {
  if (!deudor || !obligacion) return {}
  return {
    documento: deudor.documento,
    credito: obligacion.numeroCredito,
    saldo: cop(obligacion.saldoTotal),
    dias_mora: String(obligacion.diasMora),
    tramo: obligacion.tramo,
    estado_obligacion: obligacion.estado,
  }
}

async function publico<T>(cfg: ConfigChatwoot, ruta: string, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(`${cfg.url}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  if (!respuesta.ok) {
    throw new Error(`Chatwoot ${ruta} → ${respuesta.status} ${await respuesta.text()}`)
  }
  return (await respuesta.json()) as T
}

async function aplicacion(
  cfg: ConfigChatwoot,
  ruta: string,
  metodo: 'POST' | 'PUT',
  cuerpo: unknown,
): Promise<void> {
  const respuesta = await fetch(`${cfg.url}/api/v1/accounts/${cfg.cuentaId}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', api_access_token: cfg.token },
    body: JSON.stringify(cuerpo),
  })
  if (!respuesta.ok) {
    throw new Error(`Chatwoot ${ruta} → ${respuesta.status} ${await respuesta.text()}`)
  }
}
