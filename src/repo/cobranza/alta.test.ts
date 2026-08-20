import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearDeudorConObligacion } from './cartera'
import { abrirOReutilizar, cerrarConversacion, listarBandeja } from './conversaciones'
import { cargarContexto } from './contexto'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'

/**
 * Dar de alta un deudor y abrirle un hilo, sin correr `pnpm sembrar`.
 *
 * Hasta acá la única forma de meter cartera era la carga masiva, que sirve para
 * importar un archivo y no para "necesito un caso ahora": armar una demo,
 * reproducir un reporte, probar un arco.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
const USUARIO = 'cccccccc-1111-4111-8111-cccccccccccc'

const DATOS = {
  nombre: 'Ana Ruiz',
  tipoDocumento: 'CC' as const,
  documento: '1020304050',
  telefono: '+573001112233',
  numeroCredito: 'CR-9001',
  saldoTotal: 1_250_000,
  diasMora: 45,
}

describe('crearDeudorConObligacion', () => {
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
    await base.sembrarUsuario(TENANT, USUARIO, 'marcela@tornillo.co')
  })

  it('crea el deudor, la obligación y devuelve los dos ids', async () => {
    const { deudorId, obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)

    const ctx = await cargarContexto(base.db, TENANT, obligacionId)
    expect(ctx?.deudor.id).toBe(deudorId)
    expect(ctx?.deudor.nombre).toBe('Ana Ruiz')
    expect(ctx?.obligacion.saldoTotal).toBe(1_250_000)
  })

  it('deriva el tramo de la mora en vez de dejarlo elegir', async () => {
    // 45 días es `media`. Pedirlo por formulario permite un deudor con 200 días
    // en cadencia `preventiva`, que es la que dice "la cuota todavía no vence".
    const { obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const ctx = await cargarContexto(base.db, TENANT, obligacionId)
    expect(ctx?.obligacion.tramo).toBe('media')

    const { obligacionId: sinMora } = await crearDeudorConObligacion(base.db, TENANT, {
      ...DATOS,
      documento: '9999',
      numeroCredito: 'CR-9002',
      diasMora: 0,
    })
    const ctxSin = await cargarContexto(base.db, TENANT, sinMora)
    expect(ctxSin?.obligacion.tramo).toBe('preventiva')
    expect(ctxSin?.obligacion.estado).toBe('al_dia')
  })

  it('nace contactable, que es lo que quiso quien lo cargó', async () => {
    // Sin consentimiento el guard lo bloquea por `sin_consentimiento` y el
    // deudor recién creado no puede recibir nada. Alguien que carga un caso a
    // mano lo carga porque ya tiene el papel firmado.
    const { obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const ctx = await cargarContexto(base.db, TENANT, obligacionId)

    expect(ctx?.deudor.consentimiento.otorgado).toBe(true)
    expect(ctx?.deudor.consentimiento.revocadoEn).toBeNull()
    expect(ctx?.deudor.numeroErradoEn).toBeNull()
  })

  it('el mismo documento dos veces actualiza, no duplica', async () => {
    await crearDeudorConObligacion(base.db, TENANT, DATOS)
    await crearDeudorConObligacion(base.db, TENANT, { ...DATOS, nombre: 'Ana María Ruiz' })

    const deudores = await base.db.query(`SELECT id FROM deudores WHERE tenant_id = $1`, [TENANT])
    expect(deudores).toHaveLength(1)
  })

  it('el mismo documento en dos clientes son dos deudores', async () => {
    // La llave natural es (tenant, tipo, documento). Dos ferreterías pueden
    // cobrarle a la misma persona sin verse.
    await crearDeudorConObligacion(base.db, TENANT, DATOS)
    await crearDeudorConObligacion(base.db, OTRO, DATOS)

    const deA = await base.db.query(`SELECT id FROM deudores WHERE tenant_id = $1`, [TENANT])
    const deB = await base.db.query(`SELECT id FROM deudores WHERE tenant_id = $1`, [OTRO])
    expect(deA).toHaveLength(1)
    expect(deB).toHaveLength(1)
  })
})

describe('cerrarConversacion', () => {
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
    await base.sembrarUsuario(TENANT, USUARIO, 'marcela@tornillo.co')
  })

  it('deja abrir un hilo nuevo con el mismo deudor', async () => {
    // `abrirOReutilizar` devuelve el abierto si ya hay uno: el índice parcial
    // permite uno solo por deudor. Sin forma de cerrar, no había forma de
    // empezar de cero nunca.
    const { deudorId, obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const ahora = new Date().toISOString()

    const primera = await abrirOReutilizar(base.db, TENANT, { deudorId, obligacionId, ahora })
    const reusa = await abrirOReutilizar(base.db, TENANT, { deudorId, obligacionId, ahora })
    expect(reusa.id).toBe(primera.id)
    expect(reusa.nueva).toBe(false)

    expect(await cerrarConversacion(base.db, TENANT, primera.id)).toBe(true)

    const segunda = await abrirOReutilizar(base.db, TENANT, { deudorId, obligacionId, ahora })
    expect(segunda.nueva).toBe(true)
    expect(segunda.id).not.toBe(primera.id)
  })

  it('el hilo cerrado sale de la bandeja', async () => {
    const { deudorId, obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const { id } = await abrirOReutilizar(base.db, TENANT, {
      deudorId,
      obligacionId,
      ahora: new Date().toISOString(),
    })

    expect(await listarBandeja(base.db, TENANT, { usuarioId: USUARIO })).toHaveLength(1)
    await cerrarConversacion(base.db, TENANT, id)
    expect(await listarBandeja(base.db, TENANT, { usuarioId: USUARIO })).toHaveLength(0)
  })

  it('cerrar dos veces no reescribe la fecha del cierre', async () => {
    const { deudorId, obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const { id } = await abrirOReutilizar(base.db, TENANT, {
      deudorId,
      obligacionId,
      ahora: new Date().toISOString(),
    })

    expect(await cerrarConversacion(base.db, TENANT, id, '2026-08-01T10:00:00Z')).toBe(true)
    expect(await cerrarConversacion(base.db, TENANT, id, '2026-08-05T10:00:00Z')).toBe(false)

    const [fila] = await base.db.query<{ cerrada_en: Date }>(
      `SELECT cerrada_en FROM conversaciones WHERE id = $1`,
      [id],
    )
    expect(fila.cerrada_en.toISOString()).toBe('2026-08-01T10:00:00.000Z')
  })

  it('no cierra el hilo de otro cliente', async () => {
    await base.sembrarTenant(OTRO, 'Distribuidora Andina')
    const { deudorId, obligacionId } = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    const { id } = await abrirOReutilizar(base.db, TENANT, {
      deudorId,
      obligacionId,
      ahora: new Date().toISOString(),
    })

    expect(await cerrarConversacion(base.db, OTRO, id)).toBe(false)
    expect(await listarBandeja(base.db, TENANT, { usuarioId: USUARIO })).toHaveLength(1)
  })
})
