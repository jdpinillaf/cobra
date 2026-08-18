/**
 * La frontera con Postgres.
 *
 * Una interfaz de dos métodos y nada más. Existe para que los tests corran
 * contra Postgres de verdad (PGlite en proceso) sin depender de Supabase ni de
 * Docker, y para que producción use el driver que sea sin que el repositorio se
 * entere.
 *
 * No es un ORM ni la semilla de uno. En cuanto empiece a tener `where()` o
 * `select()` hay que parar: el SQL de este sistema es corto y explícito, y una
 * capa que lo esconda haría más difícil ver si un query se olvidó del tenant,
 * que es exactamente el bug que estamos tratando de evitar.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
}
