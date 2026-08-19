import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { cerrarSesion, crearSesion, resolverSesion, secretoDeSesion } from './sesion'

/**
 * Sesiones.
 *
 * El tenant sale de acá. O sea que una sesión mal resuelta no es "un usuario mal
 * identificado": es un request atendido con el tenant equivocado, leyendo la
 * cartera de otra empresa. Es el punto más sensible del sistema y por eso la
 * sesión tiene estado en la base — para poder revocarla — y la cookie solo lleva
 * un id firmado.
 *
 * La búsqueda corre con la llave de servicio porque todavía no se sabe de qué
 * tenant es el request. Es el único lugar donde eso es correcto: es la frontera
 * donde el tenant se descubre en vez de asumirse.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
const MARCELA = 'cccccccc-1111-4111-8111-cccccccccccc'
const AJENO = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'

vi.stubEnv('SESION_SECRETO', 'secreto-de-prueba-suficientemente-largo-32')

describe('sesiones', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'Ferretería El Tornillo')
    await base.sembrarTenant(OTRO, 'Distribuidora Andina')
    await base.sembrarUsuario(TENANT, MARCELA, 'marcela@tornillo.co')
    await base.sembrarUsuario(OTRO, AJENO, 'ajeno@andina.co')
  })

  it('resuelve una sesión recién creada al usuario y su tenant', async () => {
    const { cookie } = await crearSesion(base.db, TENANT, MARCELA)

    const sesion = await resolverSesion(base.db, cookie)

    expect(sesion).toEqual({ usuarioId: MARCELA, tenantId: TENANT, rol: 'operador' })
  })

  it('rechaza una cookie manipulada', async () => {
    const { cookie } = await crearSesion(base.db, TENANT, MARCELA)
    const [id, firma] = cookie.split('.')

    // Cambiar un carácter por otro FIJO es un test que falla una de cada
    // dieciséis veces: si el original ya era ese carácter, no se modificó nada.
    // Se rota dentro del alfabeto hexadecimal para garantizar el cambio.
    const distinto = (hex: string) => {
      const ultimo = hex.at(-1)!
      return hex.slice(0, -1) + '0123456789abcdef'[('0123456789abcdef'.indexOf(ultimo) + 1) % 16]
    }

    // Un id alterado con la firma de esta sesión; la firma alterada con el id
    // correcto; y la firma recortada.
    expect(await resolverSesion(base.db, `${distinto(id)}.${firma}`)).toBeNull()
    expect(await resolverSesion(base.db, `${id}.${distinto(firma)}`)).toBeNull()
    expect(await resolverSesion(base.db, `${id}.${firma.slice(0, 8)}`)).toBeNull()
  })

  it('rechaza un id de sesión sin firma', async () => {
    const { id } = await crearSesion(base.db, TENANT, MARCELA)

    // Conocer el id no alcanza: sin la firma no entra. Eso es lo que impide que
    // un id filtrado en un log sirva para entrar.
    expect(await resolverSesion(base.db, id)).toBeNull()
    expect(await resolverSesion(base.db, `${id}.`)).toBeNull()
  })

  it('rechaza basura sin lanzar', async () => {
    for (const basura of ['', '.', 'a.b', 'no-es-uuid.firma', '..', 'x'.repeat(500)]) {
      expect(await resolverSesion(base.db, basura)).toBeNull()
    }
  })

  it('rechaza una sesión vencida', async () => {
    const { id, cookie } = await crearSesion(base.db, TENANT, MARCELA)
    await base.db.query(`UPDATE sesiones SET expira_en = now() - interval '1 second' WHERE id = $1`, [id])

    expect(await resolverSesion(base.db, cookie)).toBeNull()
  })

  it('rechaza la sesión de un usuario desactivado', async () => {
    const { cookie } = await crearSesion(base.db, TENANT, MARCELA)
    await base.db.query('UPDATE tenant_usuarios SET activo = false WHERE id = $1', [MARCELA])

    // Desactivar a alguien lo saca ya, no cuando venza su cookie.
    expect(await resolverSesion(base.db, cookie)).toBeNull()
  })

  it('cerrar sesión la invalida de inmediato', async () => {
    const { id, cookie } = await crearSesion(base.db, TENANT, MARCELA)

    await cerrarSesion(base.db, id)

    expect(await resolverSesion(base.db, cookie)).toBeNull()
  })

  it('la sesión no se puede crear cruzando tenants', async () => {
    // La llave foránea compuesta lo impide en la base. Acá se fija que además
    // no haya un camino en el código que lo intente.
    await expect(crearSesion(base.db, TENANT, AJENO)).rejects.toThrow()
  })

  it('sin SESION_SECRETO falla ruidoso en vez de usar uno por defecto', () => {
    vi.stubEnv('SESION_SECRETO', '')
    try {
      // Un secreto por defecto es peor que no tener sesiones: todas las firmas
      // serían falsificables por cualquiera que lea el repo.
      expect(() => secretoDeSesion()).toThrow(/SESION_SECRETO/)
    } finally {
      vi.stubEnv('SESION_SECRETO', 'secreto-de-prueba-suficientemente-largo-32')
    }
  })

  it('rechaza un secreto demasiado corto', () => {
    vi.stubEnv('SESION_SECRETO', 'corto')
    try {
      expect(() => secretoDeSesion()).toThrow(/32/)
    } finally {
      vi.stubEnv('SESION_SECRETO', 'secreto-de-prueba-suficientemente-largo-32')
    }
  })
})
