import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearBaseDePrueba, type BaseDePrueba } from './prueba'
import { guardarCorreoCrudo, listarCorreosCrudos } from './raw-emails'

/**
 * El test que hace real la decisión de aislamiento.
 *
 * El plan decía "RLS desde la primera migración" y eso solo es media verdad: el
 * worker y las rutas de API escriben con la service key, que **ignora RLS por
 * completo**. O sea que RLS no protege el 90% del código y encima da sensación
 * de estar protegido, que es peor que no tener nada.
 *
 * Por eso hay dos capas y este archivo prueba las dos:
 *
 *   1. La capa de repositorio: toda función recibe `tenantId` de primer
 *      parámetro y filtra por él. Funciona incluso con la service key.
 *   2. RLS como red: si alguien escribe un query suelto y se olvida del filtro,
 *      la base devuelve vacío en vez de datos de otro cliente.
 *
 * La segunda es la que importa acá, porque prueba lo que pasa cuando la primera
 * falla. Un test que solo ejercita el camino correcto no prueba una red.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

describe('aislamiento entre clientes', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT_A, 'Panadería Doña Luz')
    await base.sembrarTenant(TENANT_B, 'Ferretería El Tornillo')
  })

  it('el repositorio solo devuelve las filas del tenant que se le pidió', async () => {
    await guardarCorreoCrudo(base.db, TENANT_A, { messageId: 'a-1', crudo: 'correo de A' })
    await guardarCorreoCrudo(base.db, TENANT_B, { messageId: 'b-1', crudo: 'correo de B' })

    const deA = await listarCorreosCrudos(base.db, TENANT_A)

    expect(deA).toHaveLength(1)
    expect(deA[0].messageId).toBe('a-1')
  })

  it('RLS devuelve vacío cuando un query se olvida de filtrar por tenant', async () => {
    await guardarCorreoCrudo(base.db, TENANT_A, { messageId: 'a-1', crudo: 'correo de A' })
    await guardarCorreoCrudo(base.db, TENANT_B, { messageId: 'b-1', crudo: 'correo de B' })

    // El query descuidado que tarde o temprano alguien escribe.
    const descuidado = await base.comoTenant(TENANT_A, 'SELECT message_id FROM raw_emails')

    expect(descuidado).toHaveLength(1)
    expect(descuidado[0].message_id).toBe('a-1')
  })

  it('RLS impide escribir una fila con el tenant de otro', async () => {
    await expect(
      base.comoTenant(TENANT_A, `INSERT INTO raw_emails (tenant_id, message_id, crudo)
         VALUES ('${TENANT_B}', 'robado', 'x')`),
    ).rejects.toThrow(/row-level security/i)
  })

  it('la service key ve todo, que es exactamente por qué el repositorio filtra', async () => {
    await guardarCorreoCrudo(base.db, TENANT_A, { messageId: 'a-1', crudo: 'correo de A' })
    await guardarCorreoCrudo(base.db, TENANT_B, { messageId: 'b-1', crudo: 'correo de B' })

    // Sin `comoTenant` la conexión es superusuario, el equivalente de la service
    // key. Ve las dos. Documentado a propósito: es el supuesto que hace falso
    // creer que RLS sola aísla.
    const todo = await base.db.query<{ message_id: string }>('SELECT message_id FROM raw_emails')

    expect(todo).toHaveLength(2)
  })

  it('todas las tablas tienen RLS activo y una política de tenant', async () => {
    // Atrapa el modo de falla real: alguien agrega una tabla en una migración
    // futura y se olvida de la política. Sin esto se descubre en producción.
    const sinRls = await base.db.query<{ tablename: string }>(`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (NOT c.relrowsecurity
             OR NOT EXISTS (SELECT 1 FROM pg_policies p
                            WHERE p.schemaname = 'public' AND p.tablename = c.relname))
    `)

    expect(sinRls.map((t) => t.tablename)).toEqual([])
  })
})
