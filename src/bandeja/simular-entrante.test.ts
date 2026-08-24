import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { abrirOReutilizar } from '@/repo/cobranza/conversaciones'
import { ventanaDe } from '@/repo/cobranza/ventanas'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { simularEntrante } from './simular-entrante'

/**
 * El botón que escribe como si escribiera el deudor.
 *
 * Lo que estos tests protegen no es que funcione: es que **no sea un atajo**.
 * Un camino de escritura que existe solo para la demo es el que después queda
 * encendido donde no debe, así que la mitad de los casos de acá son sobre lo
 * que tiene que rechazar y sobre la marca que deja en los datos.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const TELEFONO = '+573001112233'

describe('simularEntrante', () => {
  let base: BaseDePrueba
  let conversacionId: string

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
    await base.sembrarDeudorConObligacion(TENANT, DEUDOR, OBLIGACION)
    await base.db.query(`UPDATE deudores SET telefonos = ARRAY[$2::text] WHERE id = $1`, [
      DEUDOR,
      TELEFONO,
    ])
    await base.db.query(
      `UPDATE tenants SET phone_number_id = '10627', modo_demo = true WHERE id = $1`,
      [TENANT],
    )
    const abierta = await abrirOReutilizar(base.db, TENANT, {
      deudorId: DEUDOR,
      obligacionId: OBLIGACION,
      ahora: new Date().toISOString(),
    })
    conversacionId = abierta.id
  })

  it('escribe el entrante en el hilo', async () => {
    const r = await simularEntrante(base.db, {
      tenantId: TENANT,
      conversacionId,
      texto: 'ya pagué ayer',
      responder: false,
    })
    expect(r.ok).toBe(true)

    const [contacto] = await base.db.query<{ cuerpo: string; direccion: string }>(
      `SELECT cuerpo, direccion FROM contactos WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(contacto.direccion).toBe('entrante')
    expect(contacto.cuerpo).toBe('ya pagué ayer')
  })

  it('el agente contesta, que es el sentido del botón', async () => {
    // Sin clave de modelo el cerebro cae a `responderGuionado`, que es su
    // respaldo de producción. La respuesta es fija pero el camino es el real:
    // compuerta, herramientas, proveedor y `Contacto` saliente registrado.
    await simularEntrante(base.db, {
      tenantId: TENANT,
      conversacionId,
      texto: 'ya pagué eso, revisen bien por favor',
    })

    const contactos = await base.db.query<{ direccion: string; cuerpo: string }>(
      `SELECT direccion, cuerpo FROM contactos WHERE tenant_id = $1 ORDER BY ocurrido_en, direccion`,
      [TENANT],
    )
    const saliente = contactos.find((c) => c.direccion === 'saliente')
    expect(saliente).toBeDefined()
    expect(saliente!.cuerpo).not.toBe('')
  })

  it('con el agente pausado el deudor escribe y nadie le contesta', async () => {
    // La pausa es una decisión operativa: un asesor tomó el hilo. Que el bot
    // conteste encima es el bug que la bandeja vino a cerrar.
    await base.db.query(
      `UPDATE conversaciones SET agente_pausado = true WHERE tenant_id = $1 AND id = $2`,
      [TENANT, conversacionId],
    )

    await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: 'hola?' })

    const salientes = await base.db.query(
      `SELECT id FROM contactos WHERE tenant_id = $1 AND direccion = 'saliente'`,
      [TENANT],
    )
    // Ni siquiera un bloqueado: una pausa no es un intento de contacto, y
    // escribirlo inventaría evidencia para el reporte de cumplimiento.
    expect(salientes).toHaveLength(0)
  })

  it('lo marca como simulado, para siempre', async () => {
    // Es la diferencia entre una demo y una mentira. Un mensaje que nos
    // inventamos nosotros no puede contarse como evidencia ante la SIC ni sumar
    // en la pantalla de consumo, y quien consulte la tabla dentro de un año
    // tiene que poder separarlos sin adivinar.
    await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: 'hola' })

    const [contacto] = await base.db.query<{ proveedor: string }>(
      `SELECT proveedor FROM contactos WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(contacto.proveedor).toBe('simulado')
  })

  it('abre la ventana de servicio de 24 h, como el webhook real', async () => {
    // Sin esto el redactor de la consola sigue en "solo plantillas" y la demo
    // no puede mostrar lo único que hay que mostrar: una conversación.
    await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: 'hola' })

    const ventana = await ventanaDe(base.db, TENANT, DEUDOR)
    expect(ventana).not.toBeNull()
  })

  it('recorre el opt-out del camino real, no uno propio', async () => {
    // La prueba de que pasa por `procesarWebhook`: nadie escribió detección de
    // bajas en este módulo, y sin embargo la baja se aplica.
    await simularEntrante(base.db, {
      tenantId: TENANT,
      conversacionId,
      texto: 'no me escriban más',
    })

    const [deudor] = await base.db.query<{ revocado_en: Date | null }>(
      `SELECT revocado_en FROM deudores WHERE tenant_id = $1 AND id = $2`,
      [TENANT, DEUDOR],
    )
    expect(deudor.revocado_en).not.toBeNull()
  })

  it('rechaza si el cliente no está en modo demo', async () => {
    await base.db.query(`UPDATE tenants SET modo_demo = false WHERE id = $1`, [TENANT])

    const r = await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: 'hola' })

    expect(r.ok).toBe(false)
    const filas = await base.db.query(`SELECT id FROM contactos WHERE tenant_id = $1`, [TENANT])
    expect(filas).toHaveLength(0)
  })

  it('no alcanza la conversación de otro cliente', async () => {
    // El id de conversación viene de un formulario: es un dato del usuario, no
    // una autorización. Lo que lo acota es el `WHERE tenant_id` del repositorio.
    // Con su propio número y su propio modo demo: lo único que le falta es la
    // conversación, que es de otro. Sin esto el test pasaría por el motivo
    // equivocado —el otro tenant se caería antes, por no tener número.
    await base.db.query(
      `UPDATE tenants SET modo_demo = true, phone_number_id = '99881' WHERE id = $1`,
      [OTRO],
    )

    const r = await simularEntrante(base.db, {
      tenantId: OTRO,
      conversacionId,
      texto: 'hola',
    })

    expect(r.ok).toBe(false)
    expect(r.error).toContain('conversación')
  })

  it('rechaza si el cliente no tiene número de WhatsApp', async () => {
    // El webhook resuelve el tenant por ese número. Sin él, el payload no le
    // corresponde a nadie y `procesarWebhook` lo escribiría en el vacío en
    // silencio: el botón parecería andar y no pasaría nada.
    await base.db.query(`UPDATE tenants SET phone_number_id = NULL WHERE id = $1`, [TENANT])

    const r = await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: 'hola' })
    expect(r.ok).toBe(false)
  })

  it('rechaza el mensaje vacío', async () => {
    const r = await simularEntrante(base.db, { tenantId: TENANT, conversacionId, texto: '   ' })
    expect(r.ok).toBe(false)
  })

  it('el mismo wamid dos veces entra una sola vez', async () => {
    // La idempotencia tampoco se reimplementa acá: es la de `procesarWebhook`.
    const args = {
      tenantId: TENANT,
      conversacionId,
      texto: 'hola',
      idProveedor: 'wamid.FIJO',
      responder: false,
    }
    await simularEntrante(base.db, args)
    await simularEntrante(base.db, args)

    const filas = await base.db.query(`SELECT id FROM contactos WHERE tenant_id = $1`, [TENANT])
    expect(filas).toHaveLength(1)
  })
})
