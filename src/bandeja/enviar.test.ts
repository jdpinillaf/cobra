import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProveedorSimulado } from '@/channels/provider'
import { hiloDeConversacion, listarBandeja } from '@/repo/cobranza/conversaciones'
import { abrirOReutilizar } from '@/repo/cobranza/conversaciones'
import { renovarVentana } from '@/repo/cobranza/ventanas'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { enviarManual } from './enviar'

/**
 * Enviar a mano, de punta a punta contra Postgres.
 *
 * Prueba el camino completo: decisión de ventana, envío por el proveedor,
 * registro del contacto con su costo, y la pausa automática del agente. El
 * proveedor es el simulado, así que no toca la red ni gasta un peso, pero todo
 * lo demás es el código que corre en producción.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const MARCELA = 'cccccccc-1111-4111-8111-cccccccccccc'
const AHORA = new Date('2026-08-20T15:00:00-05:00')

describe('enviarManual', () => {
  let base: BaseDePrueba
  let conversacionId: string
  let proveedor: ProveedorSimulado

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'Ferretería El Tornillo')
    await base.sembrarDeudorConObligacion(TENANT, DEUDOR, OBLIGACION)
    await base.sembrarUsuario(TENANT, MARCELA, 'marcela@tornillo.co')
    const c = await abrirOReutilizar(base.db, TENANT, {
      deudorId: DEUDOR,
      obligacionId: OBLIGACION,
      ahora: AHORA.toISOString(),
    })
    conversacionId = c.id
    proveedor = new ProveedorSimulado()
  })

  const enviar = (datos: Parameters<typeof enviarManual>[1]['datos']) =>
    enviarManual(base.db, {
      tenantId: TENANT,
      usuarioId: MARCELA,
      conversacionId,
      datos,
      ahora: AHORA,
      proveedor,
    })

  const abrirVentana24h = () =>
    renovarVentana(base.db, TENANT, DEUDOR, '2026-08-20T09:00:00-05:00')

  it('manda texto libre con la ventana abierta y no cobra nada', async () => {
    await abrirVentana24h()

    const r = await enviar({ texto: 'Confirmado, le llega el link.' })

    expect(r.ok).toBe(true)
    // Dentro de la ventana Meta no cobra: es un mensaje de servicio.
    expect(r.costoCop).toBe(0)
    expect(proveedor.enviados).toHaveLength(1)
    expect(proveedor.enviados[0].cuerpo).toBe('Confirmado, le llega el link.')
  })

  it('el mensaje aparece en el hilo, del lado de la empresa', async () => {
    await abrirVentana24h()
    await enviar({ texto: 'Ahí va el link.' })

    const hilo = await hiloDeConversacion(base.db, TENANT, conversacionId)

    expect(hilo).toHaveLength(1)
    expect(hilo[0].direccion).toBe('saliente')
    expect(hilo[0].cuerpo).toBe('Ahí va el link.')
  })

  it('responder a mano pausa el agente, sin que nadie apriete el botón', async () => {
    await abrirVentana24h()
    await enviar({ texto: 'Yo sigo desde acá.' })

    const [fila] = await listarBandeja(base.db, TENANT, { usuarioId: MARCELA })

    // Es la razón de ser de la bandeja: dos voces en el mismo hilo es lo que el
    // cliente evita al dejar de cobrar desde los celulares de sus vendedores.
    expect(fila.agentePausado).toBe(true)
    expect(fila.motivoPausa).toBe('Respondió un asesor')
  })

  it('rechaza texto libre con la ventana cerrada, sin intentar el envío', async () => {
    // Sin renovar la ventana: nunca escribió el deudor.
    const r = await enviar({ texto: 'hola' })

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/plantilla/i)
    // Lo importante: no se gastó un envío ni se registró un contacto falso.
    expect(proveedor.enviados).toHaveLength(0)
    expect(await hiloDeConversacion(base.db, TENANT, conversacionId)).toHaveLength(0)
  })

  it('con plantilla aprobada sí manda fuera de la ventana, y cobra', async () => {
    const [p] = await base.db.query<{ id: string }>(
      `INSERT INTO plantillas (tenant_id, nombre, canal, categoria, nombre_meta, cuerpo, variables, aprobada_en_meta)
       VALUES ($1,'recordatorio','whatsapp','utility','recordatorio','Hola {{1}}, su saldo es {{2}}.',ARRAY['nombre','saldo'],true)
       RETURNING id`,
      [TENANT],
    )

    const r = await enviar({ plantillaId: p.id, variables: ['Ana', '$1.245.000'] })

    expect(r.ok).toBe(true)
    // Una plantilla utility se cobra aunque la ventana esté cerrada.
    expect(r.costoCop).toBeGreaterThan(0)
    expect(proveedor.enviados[0].cuerpo).toBe('Hola Ana, su saldo es $1.245.000.')
  })

  it('no le escribe a quien pidió la baja, ni con plantilla', async () => {
    await abrirVentana24h()
    await base.db.query(`UPDATE deudores SET revocado_en = now() WHERE id = $1`, [DEUDOR])

    const r = await enviar({ texto: 'una última cosa' })

    // El opt-out es del deudor y es de ley. No lo levanta un asesor con ganas.
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/baja/i)
    expect(proveedor.enviados).toHaveLength(0)
  })

  it('registra el intento aunque el envío falle', async () => {
    await abrirVentana24h()
    proveedor.programarFallo('+573001112233')

    const r = await enviar({ texto: 'esto no va a salir' })

    expect(r.ok).toBe(false)
    // El asesor tiene que ver que no llegó, y el log de cumplimiento tiene que
    // contarlo: un intento fallido sigue siendo un intento.
    const hilo = await hiloDeConversacion(base.db, TENANT, conversacionId)
    expect(hilo).toHaveLength(1)
    expect(hilo[0].resultado).toBe('fallido')
  })
})
