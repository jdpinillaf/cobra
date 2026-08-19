import type { Db } from './db'

/**
 * Corre un bloque con RLS de verdad activo.
 *
 * En producción se escribe con la service key, y la service key **saltea RLS
 * por completo**. O sea que las políticas escritas en las migraciones no se
 * evalúan nunca en el 90% del código, y el aislamiento queda entero en manos de
 * que ninguna función del repositorio se olvide del `tenant_id`. Eso funciona
 * hasta el día que alguien escriba un query suelto.
 *
 * `conTenant` baja de rol dentro de una transacción y fija el tenant, así que
 * adentro del bloque la base también protege. Es la red debajo de la capa de
 * repositorio, no un reemplazo de ella.
 *
 * Ambos ajustes son `LOCAL`: mueren con la transacción. Sin eso quedarían
 * pegados a la conexión, y contra un pool el próximo request sería atendido con
 * el tenant del request anterior — la peor forma posible de filtrar datos,
 * porque es intermitente y depende de qué conexión toque.
 *
 * **Requisito de despliegue:** el rol `app` tiene que existir en la base, sin
 * `BYPASSRLS` y con permisos sobre las tablas. Si no existe, esto falla ruidoso
 * en el primer request, que es como tiene que fallar.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function conTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  // `SET LOCAL` no acepta parámetros, así que la tentación es interpolar el
  // tenant en el SQL. Abajo se usa `set_config`, que sí los acepta; esta guarda
  // está por si alguien vuelve a la interpolación, y porque un tenantId que no
  // es uuid ya es un bug aguas arriba.
  if (!UUID.test(tenantId)) {
    throw new Error(`tenantId no es un uuid: ${JSON.stringify(tenantId)}`)
  }

  return db.transaccion(async (tx) => {
    await tx.query('SET LOCAL ROLE app')
    // El tercer argumento en true es lo que lo hace LOCAL a la transacción.
    await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    return fn(tx)
  })
}
