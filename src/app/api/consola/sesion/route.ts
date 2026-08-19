import { cookies } from 'next/headers'
import { z } from 'zod'
import { verificarClave } from '@/auth/clave'
import { COOKIE_SESION } from '@/auth/actual'
import { cerrarSesion, crearSesion, resolverSesion } from '@/auth/sesion'
import { obtenerDb } from '@/repo/conexion'

const Credenciales = z.object({
  email: z.string().email().max(200),
  clave: z.string().min(1).max(200),
})

/**
 * Entrar y salir.
 *
 * Un solo mensaje de error para email inexistente y clave incorrecta. Decir
 * "ese correo no existe" le regala a quien prueba la mitad del trabajo: le
 * confirma qué cuentas hay.
 *
 * El hash se verifica **siempre**, incluso cuando el usuario no existe, contra
 * un hash de descarte. Si no, el tiempo de respuesta distingue un correo válido
 * de uno inventado y el mensaje único no sirve de nada.
 */

// Hash real de una clave que nadie conoce. Existe para gastar el mismo tiempo
// cuando el usuario no existe.
const HASH_DE_DESCARTE =
  'scrypt$16384$8$1$00000000000000000000000000000000$' +
  '0000000000000000000000000000000000000000000000000000000000000000'

export async function POST(request: Request): Promise<Response> {
  const cuerpo = Credenciales.safeParse(await request.json().catch(() => null))
  if (!cuerpo.success) {
    return Response.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const db = await obtenerDb()
  const [usuario] = await db.query<{ id: string; tenant_id: string; hash_clave: string }>(
    `SELECT id, tenant_id, hash_clave FROM tenant_usuarios WHERE lower(email) = lower($1) AND activo`,
    [cuerpo.data.email],
  )

  const ok = await verificarClave(cuerpo.data.clave, usuario?.hash_clave ?? HASH_DE_DESCARTE)
  if (!usuario || !ok) {
    return Response.json({ error: 'Correo o contraseña incorrectos.' }, { status: 401 })
  }

  const { cookie } = await crearSesion(db, usuario.tenant_id, usuario.id)
  ;(await cookies()).set(COOKIE_SESION, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  })

  return Response.json({ ok: true })
}

export async function DELETE(): Promise<Response> {
  const tarro = await cookies()
  const cookie = tarro.get(COOKIE_SESION)?.value

  if (cookie) {
    const db = await obtenerDb()
    // Se borra la fila, no solo la cookie: si no, la sesión sigue viva para
    // quien tenga una copia de la cookie.
    const sesion = await resolverSesion(db, cookie)
    if (sesion) {
      const id = cookie.slice(0, cookie.lastIndexOf('.'))
      await cerrarSesion(db, id)
    }
  }

  tarro.delete(COOKIE_SESION)
  return Response.json({ ok: true })
}
