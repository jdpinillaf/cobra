import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProveedorSimulado } from '@/channels/provider'
import { hiloDeConversacion } from '@/repo/cobranza/conversaciones'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { ejecutarPaso, pasosPendientes } from './motor'

/**
 * El motor de cobro, de punta a punta contra Postgres.
 *
 * Lo que se prueba acá no es "que mande un mensaje": es que **las tres ramas
 * dejan rastro**. Ante un reclamo ante la SIC, lo que prueba que la empresa
 * cumplió la Ley 2300 no es el mensaje que salió, es el que no salió y por qué.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'

// Martes 10:00 en Bogotá: dentro de la ventana legal (L-V 7 a 19).
const MARTES_10AM = new Date('2026-08-11T10:00:00-05:00')
// Domingo: la Ley 2300 lo prohíbe sin excepción.
const DOMINGO = new Date('2026-08-16T10:00:00-05:00')

describe('motor de cadencia', () => {
  let base: BaseDePrueba
  let proveedores: Record<'whatsapp' | 'sms', ProveedorSimulado>

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
    // La obligación del arnés vence el 2026-07-15 y va en tramo `media`.
    await base.db.query(
      `INSERT INTO cadencias (tenant_id, tramo, pasos, activa) VALUES ($1,'media',$2,true)`,
      [
        TENANT,
        JSON.stringify([
          { offsetDias: 5, canal: 'whatsapp', plantillaId: null, fallbackSms: false },
          { offsetDias: 20, canal: 'whatsapp', plantillaId: null, fallbackSms: false },
        ]),
      ],
    )
    proveedores = { whatsapp: new ProveedorSimulado(), sms: new ProveedorSimulado() }
  })

  const correr = (indice: number, ahora = MARTES_10AM) =>
    ejecutarPaso(base.db, TENANT, { obligacionId: OBLIGACION, indice, ahora, proveedores })

  it('envía el paso cuando la ley lo permite y lo deja en el hilo', async () => {
    const r = await correr(0)

    expect(r.tipo).toBe('enviado')
    expect(proveedores.whatsapp.enviados).toHaveLength(1)

    const [conv] = await base.db.query<{ id: string }>(
      `SELECT id FROM conversaciones WHERE tenant_id = $1`,
      [TENANT],
    )
    const hilo = await hiloDeConversacion(base.db, TENANT, conv.id)
    expect(hilo[0].direccion).toBe('saliente')
    expect(hilo[0].cuerpo).toContain('CR-001')
  })

  it('un domingo no envía, y deja escrito por qué', async () => {
    const r = await correr(0, DOMINGO)

    expect(r.tipo).toBe('reprogramado')
    expect(proveedores.whatsapp.enviados).toHaveLength(0)

    const [conv] = await base.db.query<{ id: string }>(
      `SELECT id FROM conversaciones WHERE tenant_id = $1`,
      [TENANT],
    )
    const hilo = await hiloDeConversacion(base.db, TENANT, conv.id)

    // El hueco de la conversación tiene que tener explicación. Sin esto, el
    // asesor ve tres días de silencio y no sabe si el sistema falló o si la ley
    // lo impidió. Y es la evidencia ante la SIC.
    expect(hilo).toHaveLength(1)
    expect(hilo[0].resultado).toBe('bloqueado')
    expect(hilo[0].motivoBloqueo).toMatch(/domingo/)
  })

  it('a quien pidió la baja no le escribe, y lo registra como detenido', async () => {
    await base.db.query(`UPDATE deudores SET revocado_en = now() WHERE id = $1`, [DEUDOR])

    const r = await correr(0)

    expect(r.tipo).toBe('detenido')
    if (r.tipo !== 'detenido') return
    expect(r.motivo).toBe('opt_out')
    expect(proveedores.whatsapp.enviados).toHaveLength(0)
  })

  it('no manda dos veces el mismo paso aunque el cron se pise', async () => {
    const primera = await correr(0)
    const segunda = await correr(0)

    expect(primera.tipo).toBe('enviado')
    // El UNIQUE de cadencia_ejecuciones decide antes de gastar nada.
    expect(segunda.tipo).toBe('omitido')
    expect(proveedores.whatsapp.enviados).toHaveLength(1)
  })

  it('dos corridas simultáneas del mismo paso solo mandan una vez', async () => {
    const [a, b] = await Promise.all([correr(0), correr(0)])

    const enviados = [a, b].filter((r) => r.tipo === 'enviado')
    expect(enviados).toHaveLength(1)
    expect(proveedores.whatsapp.enviados).toHaveLength(1)
  })

  it('sin cadencia configurada no hace nada, en vez de inventar una', async () => {
    await base.db.query(`DELETE FROM cadencias WHERE tenant_id = $1`, [TENANT])

    const r = await correr(0)

    expect(r.tipo).toBe('omitido')
    expect(proveedores.whatsapp.enviados).toHaveLength(0)
  })

  describe('qué pasos tocan hoy', () => {
    it('devuelve los vencidos y omite los futuros', async () => {
      // Vence 2026-07-15. Paso 0 a +5 días (20/07) ya pasó; paso 1 a +20 (04/08)
      // también. Al 21/07 solo corresponde el primero.
      expect(await pasosPendientes(base.db, TENANT, '2026-07-21')).toEqual([
        { obligacionId: OBLIGACION, indice: 0 },
      ])
      expect(await pasosPendientes(base.db, TENANT, '2026-08-11')).toHaveLength(2)
    })

    it('no devuelve un paso ya ejecutado', async () => {
      await correr(0)

      const pendientes = await pasosPendientes(base.db, TENANT, '2026-08-11')

      expect(pendientes).toEqual([{ obligacionId: OBLIGACION, indice: 1 }])
    })

    it('ignora las obligaciones pagadas', async () => {
      await base.db.query(`UPDATE obligaciones SET estado = 'pagada' WHERE id = $1`, [OBLIGACION])

      expect(await pasosPendientes(base.db, TENANT, '2026-08-11')).toHaveLength(0)
    })
  })
})
