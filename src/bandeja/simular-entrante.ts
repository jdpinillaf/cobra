import { responderEntrante } from '@/agent/responder'
import { construirPayloadEntrante } from '@/channels/payload-simulado'
import { procesarWebhook } from '@/channels/procesador-webhook'
import { RepositorioPostgres } from '@/repo/cobranza/webhook-pg'
import { expedienteDeConversacion } from '@/repo/cobranza/conversaciones'
import type { Db } from '@/repo/db'

/**
 * Escribir como si escribiera el deudor.
 *
 * Sirve para armar una demo y para recrear un caso sin esperar a que alguien
 * conteste. El repo ya tenía escrita la objeción, en `simular-entrante.mts`:
 *
 *   "Por eso no hay un botón en la consola que inyecte mensajes: un camino que
 *    solo existe para la demo es el que después queda encendido donde no debe."
 *
 * Sigue siendo cierta, así que esto no crea ese camino. Cuatro cerraduras:
 *
 * 1. **Pasa por `procesarWebhook`**, la misma función que corre cuando llama
 *    Meta. No hay una segunda ruta de escritura con su propia idea de qué hacer
 *    con la ventana de 24 h, el opt-out o la idempotencia.
 * 2. **El tenant sale de la sesión**, no del payload. Es más estrecho que el
 *    webhook, que lo resuelve por `phone_number_id` de lo que le mandan.
 * 3. **Exige `modo_demo`** en el tenant, que es `false` por defecto. Un cliente
 *    real no lo tiene hasta que alguien lo encienda con un UPDATE.
 * 4. **Queda marcado en la fila**: `proveedor = 'simulado'`. Un mensaje que nos
 *    inventamos nosotros no puede contarse como evidencia ante la SIC ni sumar
 *    en la pantalla de consumo, y esa distinción sobrevive para siempre.
 */

export interface ResultadoSimulacion {
  ok: boolean
  error?: string
}

const LARGO_MAXIMO = 4096

export async function simularEntrante(
  db: Db,
  params: {
    tenantId: string
    conversacionId: string
    texto: string
    ahora?: Date
    /** Inyectable para que dos llamadas en el mismo milisegundo no colisionen en los tests. */
    idProveedor?: string
    /** Origen público, para el link de pago que arme el agente. */
    urlBase?: string
    /**
     * `false` deja el entrante escrito y no hace contestar al agente.
     *
     * Lo usan los tests que miran solo el registro. En la consola siempre
     * contesta: el sentido del botón es ver la conversación, no llenar la tabla.
     */
    responder?: boolean
  },
): Promise<ResultadoSimulacion> {
  const texto = params.texto.trim()
  if (texto === '') return { ok: false, error: 'El mensaje está vacío.' }
  if (texto.length > LARGO_MAXIMO) {
    return { ok: false, error: `WhatsApp corta en ${LARGO_MAXIMO} caracteres.` }
  }

  const [tenant] = await db.query<{ modo_demo: boolean; phone_number_id: string | null }>(
    `SELECT modo_demo, phone_number_id FROM tenants WHERE id = $1`,
    [params.tenantId],
  )
  if (!tenant) return { ok: false, error: 'No existe ese cliente.' }
  if (!tenant.modo_demo) {
    return { ok: false, error: 'Este cliente no está en modo demo.' }
  }
  if (!tenant.phone_number_id) {
    // El webhook resuelve el tenant por este número. Sin él, el payload que
    // armemos no le corresponde a nadie y `procesarWebhook` lo escribiría en el
    // vacío sin decir nada.
    return { ok: false, error: 'El cliente todavía no tiene número de WhatsApp configurado.' }
  }

  const expediente = await expedienteDeConversacion(db, params.tenantId, params.conversacionId)
  if (!expediente) return { ok: false, error: 'No existe esa conversación.' }
  if (!expediente.telefono) {
    return { ok: false, error: 'Ese deudor no tiene teléfono: no hay desde dónde escribir.' }
  }

  const ahora = params.ahora ?? new Date()
  const payload = construirPayloadEntrante({
    telefono: expediente.telefono,
    phoneNumberId: tenant.phone_number_id,
    texto,
    idProveedor: params.idProveedor ?? `wamid.SIM.${ahora.getTime()}`,
    ocurridoEn: ahora,
    nombrePerfil: expediente.deudorNombre,
  })

  const resumen = await procesarWebhook(
    payload,
    new RepositorioPostgres(db, params.tenantId, { proveedor: 'simulado' }),
  )

  // A diferencia del webhook de Meta, acá se espera al agente en vez de dejarlo
  // para después: del otro lado hay una persona mirando la pantalla, y una
  // respuesta que aparece cuando ya se fue no sirve para mostrar nada.
  if (params.responder !== false) {
    for (const hilo of resumen.aResponder) {
      try {
        await responderEntrante(db, {
          tenantId: params.tenantId,
          conversacionId: hilo.conversacionId,
          ahora,
          urlBase: params.urlBase ?? 'https://ponox.co',
        })
      } catch (e) {
        // El entrante ya quedó escrito. Que el agente no conteste es un problema
        // menor que perder el mensaje, así que no se propaga.
        console.error('[simular-entrante] el agente no pudo contestar', e)
      }
    }
  }

  return { ok: true }
}

/**
 * ¿Este cliente puede escribirse a sí mismo?
 *
 * Lo lee la consola para decidir si dibuja el botón. Es comodidad, no
 * seguridad: la regla la aplica `simularEntrante` en el servidor. Acá está para
 * que la persona no vea un botón que le va a decir que no.
 */
export async function enModoDemo(db: Db, tenantId: string): Promise<boolean> {
  const [tenant] = await db.query<{ modo_demo: boolean }>(
    `SELECT modo_demo FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return tenant?.modo_demo ?? false
}
