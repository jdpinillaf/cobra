import { NextResponse } from 'next/server'
import { reiniciarDemo, telefonoProtagonista } from '@/demo/estado'
import { vistaPorTelefono } from '@/demo/servicio'

/**
 * Estado de la conversación. La pantalla lo consulta cada segundo y medio.
 *
 * Es lo que hace que dos cosas aparezcan **solas** en el teléfono: la
 * confirmación del pago y la respuesta de una persona desde Chatwoot. Sin el
 * polling habría que recargar, y en una demo en vivo recargar mata el efecto.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const telefono = new URL(request.url).searchParams.get('telefono') ?? telefonoProtagonista()
  const vista = vistaPorTelefono(telefono)

  if (!vista) {
    return NextResponse.json({ error: 'Ese número no está en la cartera.' }, { status: 404 })
  }

  return NextResponse.json(vista)
}

/** Vuelve la demo a cero. Es el botón de "otra vez" entre ensayo y ensayo. */
export async function DELETE(): Promise<Response> {
  reiniciarDemo()
  return NextResponse.json(vistaPorTelefono())
}
