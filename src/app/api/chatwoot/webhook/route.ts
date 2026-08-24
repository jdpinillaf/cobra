import { NextResponse } from 'next/server'
import { estadoDemo } from '@/demo/estado'
import { responderComoHumano } from '@/demo/servicio'

/**
 * Relevo humano: lo que una persona escribe en Chatwoot llega al teléfono.
 *
 * Es la mitad que le faltaba al espejo. Sin esto la consola sería un visor de
 * solo lectura; con esto un asesor toma la conversación y el deudor lo ve
 * aparecer en el mismo hilo, sin que nadie note el cambio de manos.
 *
 * Chatwoot dispara `message_created` **también** por los mensajes que nosotros
 * mismos publicamos al espejar. Si se reinyectaran, cada respuesta del agente
 * saldría dos veces en el teléfono. El eco se descarta comparando el texto con
 * lo que ya está en la conversación, que funciona porque el espejo publica la
 * cadena idéntica.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cuántos mensajes recientes se revisan para detectar el eco. */
const VENTANA_ECO = 6

interface EventoChatwoot {
  event?: string
  content?: string
  message_type?: string
  private?: boolean
  sender?: { name?: string; type?: string }
  conversation?: {
    meta?: { sender?: { phone_number?: string; identifier?: string } }
  }
}

export async function POST(request: Request): Promise<Response> {
  let evento: EventoChatwoot
  try {
    evento = (await request.json()) as EventoChatwoot
  } catch {
    return NextResponse.json({ ok: true })
  }

  // Siempre 200. Un webhook que devuelve error hace que Chatwoot reintente y
  // termine deshabilitando la integración.
  const ignorar = NextResponse.json({ ok: true, aplicado: false })

  if (evento.event !== 'message_created') return ignorar
  if (evento.message_type !== 'outgoing') return ignorar
  if (evento.private) return ignorar

  const texto = evento.content?.trim()
  if (!texto) return ignorar

  const remitente = evento.conversation?.meta?.sender
  const telefono = remitente?.phone_number ?? remitente?.identifier
  if (!telefono) return ignorar

  const conversacion = estadoDemo().conversaciones.get(telefono)
  if (!conversacion) return ignorar

  const esEco = conversacion.mensajes
    .slice(-VENTANA_ECO)
    .some((m) => m.de !== 'deudor' && m.texto.trim() === texto)
  if (esEco) return ignorar

  const vista = responderComoHumano({
    telefono,
    texto,
    autor: evento.sender?.name ?? 'Equipo de cobranza',
  })

  return NextResponse.json({ ok: true, aplicado: vista !== null })
}
