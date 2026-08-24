import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db } from '@/repo/db'

/**
 * Sesiones de la consola.
 *
 * El tenant sale de acá. Una sesión mal resuelta no es "un usuario mal
 * identificado": es un request atendido con el tenant equivocado, leyendo la
 * cartera de otra empresa. Es el punto más sensible del sistema.
 *
 * Por eso la sesión tiene estado en la base en vez de ir toda dentro de un token
 * firmado: se puede revocar. Desactivar a alguien lo saca en el próximo request,
 * no cuando venza su cookie. La cookie solo lleva el id firmado, así que un id
 * que se filtre en un log no sirve para entrar.
 *
 * `resolverSesion` corre con la llave de servicio, sin `conTenant`, y es
 * deliberado: todavía no se sabe de qué tenant es el request. Es el único lugar
 * del sistema donde eso es correcto, porque es la frontera donde el tenant se
 * descubre en vez de asumirse. Todo lo que venga después ya usa `conTenant`.
 *
 * No debe crecer hacia recuperación de contraseña ni SSO sin repensarlo.
 */

const HORAS_DE_VIDA = 12
const LARGO_MINIMO_SECRETO = 32

export interface Sesion {
  usuarioId: string
  tenantId: string
  rol: string
}

/**
 * Falla ruidoso si no hay secreto, y falla ruidoso si es corto.
 *
 * Un valor por defecto sería peor que no tener sesiones: todas las firmas serían
 * falsificables por cualquiera que lea el repositorio. Y un secreto corto es un
 * HMAC que se puede buscar por fuerza bruta sin apuro.
 */
export function secretoDeSesion(): string {
  const secreto = process.env.SESION_SECRETO
  if (!secreto) {
    throw new Error('falta SESION_SECRETO: la consola no arranca sin un secreto de sesión')
  }
  if (secreto.length < LARGO_MINIMO_SECRETO) {
    throw new Error(`SESION_SECRETO debe tener al menos ${LARGO_MINIMO_SECRETO} caracteres`)
  }
  return secreto
}

function firmar(id: string): string {
  return createHmac('sha256', secretoDeSesion()).update(id).digest('hex')
}

/** `<id>.<hmac>`. Sin la firma, conocer el id no sirve de nada. */
export function armarCookie(id: string): string {
  return `${id}.${firmar(id)}`
}

/**
 * Devuelve el id solo si la firma cuadra.
 *
 * La comparación es en tiempo constante: con `===`, alguien que pruebe firmas
 * puede medir cuánto prefijo acertó y construir una válida byte por byte.
 */
function idDeCookie(cookie: string): string | null {
  const corte = cookie.lastIndexOf('.')
  if (corte <= 0 || corte === cookie.length - 1) return null

  const id = cookie.slice(0, corte)
  const firma = cookie.slice(corte + 1)

  const esperada = Buffer.from(firmar(id), 'utf8')
  const recibida = Buffer.from(firma, 'utf8')
  if (esperada.length !== recibida.length) return null

  return timingSafeEqual(esperada, recibida) ? id : null
}

export async function crearSesion(
  db: Db,
  tenantId: string,
  usuarioId: string,
): Promise<{ id: string; cookie: string }> {
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO sesiones (tenant_id, usuario_id, expira_en)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)
     RETURNING id`,
    [tenantId, usuarioId, String(HORAS_DE_VIDA)],
  )
  return { id: fila.id, cookie: armarCookie(fila.id) }
}

/**
 * Resuelve la cookie a un usuario, o `null`.
 *
 * `null` ante cualquier duda: firma mala, sesión vencida, usuario desactivado o
 * borrado. Nunca lanza, porque un error acá no debe distinguirse de un rechazo:
 * la diferencia le diría a quien prueba si el id existe.
 */
export async function resolverSesion(db: Db, cookie: string): Promise<Sesion | null> {
  try {
    const id = idDeCookie(cookie)
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null

    const filas = await db.query<{ usuario_id: string; tenant_id: string; rol: string }>(
      `SELECT s.usuario_id, s.tenant_id, u.rol
         FROM sesiones s
         JOIN tenant_usuarios u
           ON u.id = s.usuario_id AND u.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.expira_en > now() AND u.activo`,
      [id],
    )
    if (filas.length === 0) return null

    return { usuarioId: filas[0].usuario_id, tenantId: filas[0].tenant_id, rol: filas[0].rol }
  } catch {
    return null
  }
}

export async function cerrarSesion(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM sesiones WHERE id = $1', [id])
}

/** Higiene: las vencidas no sirven para nada y crecen para siempre. */
export async function purgarSesionesVencidas(db: Db): Promise<number> {
  const filas = await db.query<{ id: string }>(
    'DELETE FROM sesiones WHERE expira_en <= now() RETURNING id',
  )
  return filas.length
}
