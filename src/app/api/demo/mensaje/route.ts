import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recibirMensaje } from '@/demo/servicio'

/**
 * Lo que en producción hace el webhook de Meta, pero disparado por el simulador
 * de teléfono de la demo. El pipeline que corre detrás es el mismo.
 */

export const runtime = 'nodejs'
// La conversación vive en memoria del proceso: cachear esto la congelaría.
export const dynamic = 'force-dynamic'

const Cuerpo = z.object({
  telefono: z.string().min(1),
  texto: z.string().min(1).max(1000),
})

export async function POST(request: Request): Promise<Response> {
  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 })
  }

  const parseado = Cuerpo.safeParse(crudo)
  if (!parseado.success) {
    return NextResponse.json({ error: 'Falta teléfono o texto.' }, { status: 400 })
  }

  const vista = await recibirMensaje({
    telefono: parseado.data.telefono,
    texto: parseado.data.texto,
    urlBase: new URL(request.url).origin,
  })

  if (!vista) {
    return NextResponse.json({ error: 'Ese número no está en la cartera.' }, { status: 404 })
  }

  return NextResponse.json(vista)
}
