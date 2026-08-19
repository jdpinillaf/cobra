import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generarCartera } from '@/demo/seed'
import { crearBaseDePrueba, type BaseDePrueba } from '../prueba'
import { guardarCartera, listarObligaciones } from './cartera'

/**
 * Persistir la cartera.
 *
 * Acá vive la frontera entre las dos convenciones de dinero del sistema: el
 * dominio (`src/domain/types.ts`) trabaja en **pesos enteros** y el esquema en
 * **centavos**. Convertir en el repositorio y no en los tipos es lo que permite
 * que los 484 tests existentes sigan sin tocarse.
 *
 * La misma función la usan el sembrado de desarrollo y la ingesta real, así que
 * lo que se pruebe acá vale para las dos.
 */

const FECHA_CORTE = '2026-08-19'
const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'

describe('cartera', () => {
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
  })

  it('guarda la cartera generada y la devuelve completa', async () => {
    const cartera = generarCartera({ cantidad: 40, semilla: 7, fechaCorte: FECHA_CORTE })

    const resumen = await guardarCartera(base.db, TENANT, cartera)

    expect(resumen.deudores).toBe(cartera.deudores.length)
    expect(resumen.obligaciones).toBe(cartera.obligaciones.length)
    expect(await listarObligaciones(base.db, TENANT)).toHaveLength(cartera.obligaciones.length)
  })

  it('convierte pesos a centavos en la frontera, sin tocar los tipos del dominio', async () => {
    const cartera = generarCartera({ cantidad: 1, semilla: 3, fechaCorte: FECHA_CORTE })
    const enPesos = cartera.obligaciones[0].saldoTotal

    await guardarCartera(base.db, TENANT, cartera)

    // Lo que devuelve el repositorio vuelve a estar en pesos: la conversión es
    // simétrica y el resto del código nunca ve un centavo.
    const [o] = await listarObligaciones(base.db, TENANT)
    expect(o.saldoTotal).toBe(enPesos)

    // Y en la base está en centavos, que es donde tiene que estar.
    const [fila] = await base.db.query<{ saldo_total_centavos: string }>(
      'SELECT saldo_total_centavos FROM obligaciones LIMIT 1',
    )
    expect(Number(fila.saldo_total_centavos)).toBe(enPesos * 100)
  })

  it('vuelve a cargar la misma cartera sin duplicar deudores', async () => {
    const cartera = generarCartera({ cantidad: 20, semilla: 11, fechaCorte: FECHA_CORTE })

    await guardarCartera(base.db, TENANT, cartera)
    const segunda = await guardarCartera(base.db, TENANT, cartera)

    // La cartera se sincroniza periódicamente. Si cada corrida duplicara, a la
    // semana el agente le escribiría siete veces al mismo deudor.
    expect(segunda.deudores).toBe(0)
    expect(await listarObligaciones(base.db, TENANT)).toHaveLength(cartera.obligaciones.length)
  })

  it('actualiza el saldo y la mora cuando la obligación ya existía', async () => {
    const cartera = generarCartera({ cantidad: 1, semilla: 5, fechaCorte: FECHA_CORTE })
    await guardarCartera(base.db, TENANT, cartera)

    const alDia = {
      ...cartera,
      obligaciones: [{ ...cartera.obligaciones[0], saldoTotal: 50_000, diasMora: 0, estado: 'al_dia' as const }],
    }
    await guardarCartera(base.db, TENANT, alDia)

    const [o] = await listarObligaciones(base.db, TENANT)
    expect(o.saldoTotal).toBe(50_000)
    expect(o.estado).toBe('al_dia')
  })

  it('no mezcla la cartera de dos clientes', async () => {
    await guardarCartera(base.db, TENANT, generarCartera({ cantidad: 5, semilla: 1, fechaCorte: FECHA_CORTE }))

    expect(await listarObligaciones(base.db, OTRO)).toHaveLength(0)
  })
})
