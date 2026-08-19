import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearBaseDePrueba, type BaseDePrueba } from '../prueba'
import { contactosDelDeudor, registrarContacto } from './contactos'

/**
 * `contactos` es el entregable de cumplimiento, no un log.
 *
 * La cotización vende "historial completo de cada conversación y cada intento
 * de contacto, con hora, canal, mensaje enviado, resultado y motivo, incluidos
 * los intentos bloqueados por política". Ante un reclamo ante la SIC, esta
 * tabla es la evidencia de que el sistema respetó la Ley 2300 en vez de
 * limitarse a no dejar rastro.
 *
 * Por eso el test que más importa acá no es el del mensaje enviado: es el del
 * bloqueado.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'

const base = (over: Partial<Parameters<typeof registrarContacto>[2]> = {}) => ({
  obligacionId: OBLIGACION,
  deudorId: DEUDOR,
  canal: 'whatsapp' as const,
  direccion: 'saliente' as const,
  timestamp: '2026-08-19T09:15:00-05:00',
  plantillaId: null,
  cuerpo: 'Hola, tienes un saldo pendiente.',
  resultado: 'enviado' as const,
  motivoBloqueo: null,
  costoCop: 3.2,
  idProveedor: 'wamid.abc',
  proveedor: 'meta',
  ...over,
})

describe('contactos', () => {
  let db: BaseDePrueba

  beforeAll(async () => {
    db = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await db.cerrar()
  })
  beforeEach(async () => {
    await db.limpiar()
    await db.sembrarTenant(TENANT_A, 'Ferretería El Tornillo')
    await db.sembrarTenant(TENANT_B, 'Distribuidora Andina')
    await db.sembrarDeudorConObligacion(TENANT_A, DEUDOR, OBLIGACION)
  })

  it('guarda el intento enviado con su costo sin redondear', async () => {
    await registrarContacto(db.db, TENANT_A, base())

    const [c] = await contactosDelDeudor(db.db, TENANT_A, DEUDOR)

    expect(c.resultado).toBe('enviado')
    expect(c.idProveedor).toBe('wamid.abc')
    // COP 3,2 por plantilla utility. Redondear a entero convierte el costo real
    // en cero y subestima el consumo del cupo mes a mes.
    expect(c.costoCop).toBeCloseTo(3.2, 4)
  })

  it('guarda el intento BLOQUEADO con su motivo, que es la evidencia ante la SIC', async () => {
    await registrarContacto(
      db.db,
      TENANT_A,
      base({
        resultado: 'bloqueado',
        motivoBloqueo: 'fuera_de_ventana_legal',
        cuerpo: '',
        idProveedor: null,
        proveedor: null,
        costoCop: 0,
      }),
    )

    const [c] = await contactosDelDeudor(db.db, TENANT_A, DEUDOR)

    expect(c.resultado).toBe('bloqueado')
    expect(c.motivoBloqueo).toBe('fuera_de_ventana_legal')
    // Un bloqueado no se cobra ni tiene id de proveedor: nunca salió.
    expect(c.costoCop).toBe(0)
    expect(c.idProveedor).toBeNull()
  })

  it('devuelve los intentos en orden cronológico, bloqueados incluidos', async () => {
    await registrarContacto(db.db, TENANT_A, base({ timestamp: '2026-08-19T09:00:00-05:00' }))
    await registrarContacto(
      db.db,
      TENANT_A,
      base({
        timestamp: '2026-08-20T09:00:00-05:00',
        resultado: 'bloqueado',
        motivoBloqueo: 'limite_semanal',
      }),
    )

    const historial = await contactosDelDeudor(db.db, TENANT_A, DEUDOR)

    // El historial de la consola es una sola lista. Separar los bloqueados en
    // otra pestaña rompe justo lo que se vendió.
    expect(historial.map((c) => c.resultado)).toEqual(['enviado', 'bloqueado'])
  })

  it('no mezcla el historial de dos clientes', async () => {
    await registrarContacto(db.db, TENANT_A, base())

    expect(await contactosDelDeudor(db.db, TENANT_B, DEUDOR)).toHaveLength(0)
  })
})
