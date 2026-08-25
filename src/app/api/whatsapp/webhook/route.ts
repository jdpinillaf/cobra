import { after } from 'next/server'
import { responderEntrante } from '@/agent/responder'
import {
  filtrarPorNumero,
  numerosDelPayload,
  responderVerificacion,
  verificarFirmaMeta,
} from '@/channels/meta-webhook'
import { procesarWebhook } from '@/channels/procesador-webhook'
import { conTenant } from '@/repo/con-tenant'
import { RepositorioPostgres } from '@/repo/cobranza/webhook-pg'
import { obtenerDb } from '@/repo/conexion'
import { tenantPorNumero } from '@/repo/tenants'

/**
 * Webhook de WhatsApp Cloud API.
 *
 * Primer código de servidor del repo. La landing no tenía backend y todo lo
 * demás son funciones puras; esto existe porque la mitad entrante del canal no
 * se puede simular: Meta tiene que poder llamarnos.
 *
 * La ruta se queda solo con lo que exige HTTP —cuerpo crudo, firma, códigos de
 * estado— y delega el resto a `procesarWebhook`, que se prueba sin servidor.
 *
 * No se exporta `runtime`: el default ya es Node.js y el Edge Runtime está
 * deprecado. Hace falta Node de todos modos, porque la firma usa `node:crypto`.
 */

/**
 * El `after()` corre con la duración máxima de la ruta, no con la del request.
 *
 * Adentro va un turno del modelo de hasta ocho pasos más el envío. Sin declarar
 * esto, la plataforma corta con su default y puede dejar el estado a medias:
 * acuerdo escrito, obligación en `acuerdo_vigente` —o sea cadencia frenada— y
 * el deudor sin recibir nunca la confirmación.
 */
export const maxDuration = 300

interface Pendiente {
  tenantId: string
  conversacionId: string
  telefono: string
}

/**
 * De qué cliente es cada evento.
 *
 * Meta agrupa en una sola entrega los eventos de todos los números de una misma
 * WABA, así que un lote puede traer dos empresas mezcladas. El payload se parte
 * por `phone_number_id` **antes** de tocar nada, y cada parte se procesa dentro
 * de su propio `conTenant`: así RLS también aplica, y no solo el `WHERE` de cada
 * consulta.
 *
 * Un número que no corresponde a ningún tenant se ignora en silencio. Puede ser
 * un número dado de baja, o una suscripción vieja que Meta todavía no soltó, y
 * no es motivo para devolver error y hacer que reintente el lote entero.
 */
async function procesarPorTenant(payload: unknown, urlBase: string): Promise<{ ignorados: number }> {
  const db = await obtenerDb()
  let ignorados = 0

  for (const numero of numerosDelPayload(payload)) {
    const tenant = await tenantPorNumero(db, numero)
    if (!tenant) {
      ignorados += 1
      continue
    }

    const resumen = await conTenant(db, tenant.id, (tx) =>
      procesarWebhook(filtrarPorNumero(payload, numero), new RepositorioPostgres(tx, tenant.id)),
    )
    // El `after()` se registra por tenant, apenas ese tenant commiteó. Antes se
    // acumulaban todos y se registraban al final: si el tercero lanzaba, se
    // perdían los pendientes de los dos primeros y esos deudores no recibían
    // respuesta nunca, aunque su entrante ya estuviera escrito.
    responderDespues(
      resumen.aResponder.map((h) => ({ tenantId: tenant.id, ...h })),
      urlBase,
    )
  }

  return { ignorados }
}

/**
 * El agente contesta **después** de la respuesta, no adentro.
 *
 * Dos razones, y las dos son de las que se pagan caras:
 *
 * - Meta reintenta si el 200 tarda, y degrada la entrega de la cuenta si eso se
 *   vuelve costumbre. Un turno del modelo son segundos.
 * - `procesarWebhook` corre dentro de `conTenant`, o sea dentro de una
 *   transacción con una conexión reservada. Esperar al modelo ahí la deja
 *   abierta todo ese rato, y el pool tiene fondo.
 *
 * Por eso corre fuera de la transacción y fuera del ciclo de la respuesta. Si
 * falla, el entrante y la ventana ya quedaron escritos: se pierde la respuesta
 * del agente, no la evidencia.
 */
function responderDespues(pendientes: Pendiente[], urlBase: string): void {
  if (pendientes.length === 0) return

  after(async () => {
    const db = await obtenerDb()
    for (const p of pendientes) {
      try {
        await responderEntrante(db, {
          tenantId: p.tenantId,
          conversacionId: p.conversacionId,
          paraTelefono: p.telefono,
          urlBase,
        })
      } catch (e) {
        console.error('[whatsapp-webhook] el agente no pudo contestar', p.conversacionId, e)
      }
    }
  })
}

function entorno(): { appSecret: string; tokenVerificacion: string } | null {
  const appSecret = process.env.META_APP_SECRET
  const tokenVerificacion = process.env.META_TOKEN_VERIFICACION
  if (!appSecret || !tokenVerificacion) return null
  return { appSecret, tokenVerificacion }
}

/** Handshake de suscripción. Meta lo llama una vez al registrar la URL. */
export async function GET(request: Request): Promise<Response> {
  const config = entorno()
  if (!config) return new Response('Webhook sin configurar', { status: 503 })

  const params = new URL(request.url).searchParams
  const challenge = responderVerificacion(
    {
      'hub.mode': params.get('hub.mode'),
      'hub.verify_token': params.get('hub.verify_token'),
      'hub.challenge': params.get('hub.challenge'),
    },
    config.tokenVerificacion,
  )

  if (challenge === null) return new Response('Verificación fallida', { status: 403 })
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}

export async function POST(request: Request): Promise<Response> {
  const config = entorno()
  if (!config) return new Response('Webhook sin configurar', { status: 503 })

  // El cuerpo **crudo**: la firma se calcula sobre los bytes que llegaron. Si
  // se parsea y se vuelve a serializar, el HMAC no coincide y se rechaza todo.
  const cuerpoCrudo = await request.text()

  if (!verificarFirmaMeta(cuerpoCrudo, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    // Sin esto, quien conozca la URL puede declarar entregado un mensaje que
    // nunca salió o inyectar un "BAJA" falso y apagar una cadencia.
    return new Response('Firma inválida', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(cuerpoCrudo)
  } catch {
    return new Response('JSON inválido', { status: 400 })
  }

  try {
    const { ignorados } = await procesarPorTenant(payload, new URL(request.url).origin)
    if (ignorados > 0) {
      console.warn(`[whatsapp-webhook] ${ignorados} número(s) sin tenant activo`)
    }
  } catch (e) {
    // Se responde 200 igual. Meta reintenta ante cualquier no-2xx y, si el
    // payload es el que rompe, el reintento vuelve a romper: se entra en un
    // bucle que además degrada la entrega de la cuenta. El fallo se registra y
    // se resuelve por fuera del ciclo del webhook.
    console.error('[whatsapp-webhook] fallo procesando un evento ya verificado', e)
  }

  return new Response(null, { status: 200 })
}
