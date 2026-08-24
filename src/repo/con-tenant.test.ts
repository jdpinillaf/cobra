import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { conTenant } from './con-tenant'
import { crearBaseDePrueba, type BaseDePrueba } from './prueba'
import { guardarCorreoCrudo } from './raw-emails'

/**
 * `conTenant` es lo que convierte a RLS en una red real y no en decoración.
 *
 * En producción se escribe con la service key, y la service key **saltea RLS**.
 * Si nadie baja de rol, las políticas no se evalúan nunca y el aislamiento
 * queda enteramente en manos de que ninguna función se olvide del `tenant_id`.
 * `conTenant` abre una transacción, baja a un rol sin privilegio y fija el
 * tenant, de modo que adentro de ese bloque la base también protege.
 *
 * Los tres casos son los tres modos de falla: que no se active, que se filtre
 * al siguiente query, y que un error deje la sesión con el rol cambiado.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

describe('conTenant', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT_A, 'Ferretería El Tornillo')
    await base.sembrarTenant(TENANT_B, 'Distribuidora Andina')
    await guardarCorreoCrudo(base.db, TENANT_A, { messageId: 'a-1', crudo: 'de A' })
    await guardarCorreoCrudo(base.db, TENANT_B, { messageId: 'b-1', crudo: 'de B' })
  })

  it('adentro del bloque, un query sin filtro solo ve al tenant fijado', async () => {
    const filas = await conTenant(base.db, TENANT_A, (tx) =>
      // Sin WHERE tenant_id. Es el query descuidado que alguien va a escribir.
      tx.query<{ message_id: string }>('SELECT message_id FROM raw_emails'),
    )

    expect(filas.map((f) => f.message_id)).toEqual(['a-1'])
  })

  it('el tenant no se filtra al query siguiente', async () => {
    await conTenant(base.db, TENANT_A, (tx) => tx.query('SELECT 1'))

    // Fuera del bloque vuelve a ser la service key: ve todo. Si en cambio
    // siguiera viendo solo al tenant A, el ajuste habría quedado pegado a la
    // conexión y el próximo request atendería con el tenant del anterior.
    const todo = await base.db.query('SELECT message_id FROM raw_emails')

    expect(todo).toHaveLength(2)
  })

  it('un error adentro revierte la escritura y no deja la sesión cambiada', async () => {
    await expect(
      conTenant(base.db, TENANT_A, async (tx) => {
        await tx.query(
          `INSERT INTO raw_emails (tenant_id, message_id, crudo) VALUES ($1,'a-2','x')`,
          [TENANT_A],
        )
        throw new Error('algo explotó a mitad de camino')
      }),
    ).rejects.toThrow('algo explotó')

    const todo = await base.db.query('SELECT message_id FROM raw_emails')
    expect(todo).toHaveLength(2)

    // Y la conexión sigue usable con todos sus privilegios.
    const despues = await conTenant(base.db, TENANT_B, (tx) =>
      tx.query<{ message_id: string }>('SELECT message_id FROM raw_emails'),
    )
    expect(despues.map((f) => f.message_id)).toEqual(['b-1'])
  })

  it('rechaza un tenantId que no sea uuid en vez de interpolarlo', async () => {
    // `SET LOCAL` no acepta parámetros, así que la tentación es interpolar y
    // ahí entra SQL inyectado. Se usa set_config con parámetro; esto solo fija
    // la garantía por si alguien vuelve a la interpolación.
    await expect(
      conTenant(base.db, "'; DROP TABLE raw_emails; --", (tx) => tx.query('SELECT 1')),
    ).rejects.toThrow(/uuid/i)

    expect(await base.db.query('SELECT message_id FROM raw_emails')).toHaveLength(2)
  })
})
