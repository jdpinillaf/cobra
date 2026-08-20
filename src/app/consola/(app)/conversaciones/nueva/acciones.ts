'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requerirSesion } from '@/auth/actual'
import { crearDeudorConObligacion, type DeudorNuevo } from '@/repo/cobranza/cartera'
import { abrirOReutilizar } from '@/repo/cobranza/conversaciones'
import { obtenerDb } from '@/repo/conexion'

/**
 * Alta de un caso desde la consola.
 *
 * Mismo patrón que el resto de las acciones: el `tenantId` sale de la sesión y
 * nunca del formulario. Toda la regla vive en `crearDeudorConObligacion`, que se
 * prueba sin Next.
 */

export interface ResultadoAlta {
  ok: boolean
  error?: string
}

/** E.164: `+`, indicativo y hasta 15 dígitos. Es lo que Meta acepta. */
const E164 = /^\+[1-9]\d{7,14}$/

export async function accionNuevaConversacion(datos: DeudorNuevo): Promise<ResultadoAlta> {
  const sesion = await requerirSesion()

  const nombre = datos.nombre.trim()
  const documento = datos.documento.trim()
  const numeroCredito = datos.numeroCredito.trim()
  const telefono = datos.telefono.trim()

  if (nombre === '') return { ok: false, error: 'Falta el nombre.' }
  if (documento === '') return { ok: false, error: 'Falta el documento.' }
  if (numeroCredito === '') return { ok: false, error: 'Falta el número de crédito.' }
  if (!E164.test(telefono)) {
    // Meta rechaza cualquier otra forma, y el rechazo llega recién al enviar:
    // el deudor quedaría cargado y mudo sin que nadie sepa por qué.
    return { ok: false, error: 'El teléfono va en formato internacional: +573001112233.' }
  }
  if (!Number.isFinite(datos.saldoTotal) || datos.saldoTotal <= 0) {
    return { ok: false, error: 'El saldo tiene que ser mayor que cero.' }
  }
  if (!Number.isInteger(datos.diasMora)) {
    return { ok: false, error: 'Los días de mora tienen que ser un número entero.' }
  }

  const db = await obtenerDb()

  let conversacionId: string
  try {
    const { deudorId, obligacionId } = await crearDeudorConObligacion(db, sesion.tenantId, {
      ...datos,
      nombre,
      documento,
      numeroCredito,
      telefono,
    })
    // Reutiliza el hilo si ese deudor ya tenía uno abierto. Es lo correcto: dos
    // hilos vivos con la misma persona es cómo dos asesores se pisan.
    const conversacion = await abrirOReutilizar(db, sesion.tenantId, {
      deudorId,
      obligacionId,
      ahora: new Date().toISOString(),
    })
    conversacionId = conversacion.id
  } catch (e) {
    console.error('[nueva-conversacion] falló el alta', e)
    return { ok: false, error: 'No se pudo crear. Revisá que el crédito no exista ya.' }
  }

  revalidatePath('/consola/conversaciones')
  // Fuera del try: `redirect` funciona lanzando, y atraparlo lo convertiría en
  // el error genérico de arriba.
  redirect(`/consola/conversaciones/${conversacionId}`)
}
