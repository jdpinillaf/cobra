import { NextResponse } from 'next/server'
import { z } from 'zod'
import { esReferenciaValida } from '@/payments/wompi'
import { estadoDemo } from '@/demo/estado'
import { aplicarPago } from '@/demo/servicio'

/**
 * Lo que en producción sería el webhook de la pasarela.
 *
 * Acá lo dispara la página de pago de la demo en vez de Wompi. El paso que
 * importa es el mismo y es el que hoy no existe en el motor: **leer la
 * referencia, ubicar la obligación y cerrarla**. Con Wompi de verdad, esta ruta
 * validaría el checksum del evento con `verificarChecksumWebhook()` y sacaría la
 * referencia de `interpretarEvento()`; el resto del cuerpo no cambia.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Cuerpo = z.object({ referencia: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 })
  }

  const parseado = Cuerpo.safeParse(crudo)
  if (!parseado.success || !esReferenciaValida(parseado.data.referencia)) {
    return NextResponse.json({ error: 'Referencia inválida.' }, { status: 400 })
  }

  const resultado = aplicarPago(parseado.data.referencia)
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.motivo }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

/** Datos del cobro para pintar la página de pago. */
export async function GET(request: Request): Promise<Response> {
  const referencia = new URL(request.url).searchParams.get('referencia')
  if (!referencia) return NextResponse.json({ error: 'Falta la referencia.' }, { status: 400 })

  const estado = estadoDemo()
  const pago = estado.pagos.get(referencia)
  if (!pago) return NextResponse.json({ error: 'Referencia desconocida.' }, { status: 404 })

  const obligacion = estado.cartera.obligaciones.find((o) => o.id === pago.obligacionId)
  const deudor = estado.cartera.deudores.find((d) => d.id === obligacion?.deudorId)

  return NextResponse.json({
    referencia,
    monto: pago.monto,
    estado: pago.estado,
    comercio: estado.cartera.cliente.nombre,
    deudor: deudor?.nombre ?? null,
    numeroCredito: obligacion?.numeroCredito ?? null,
    saldoTotal: obligacion?.saldoTotal ?? null,
  })
}
