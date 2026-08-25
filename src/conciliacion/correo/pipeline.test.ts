import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ingerirCorreo } from './pipeline'
import { VerificadorDeclarado } from './verificador'
import { correoBancolombia, type DatosCorreo } from '@/e2e/fixtures'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { contarCuarentena } from '@/repo/raw-emails'
import { tenantPorAlias, type ConfigConciliacion } from '@/repo/tenants'

/**
 * Los cinco puntos de caída, y que ninguno sea silencioso.
 *
 * El modo de falla más caro de este producto no es fallar: es fallar sin que
 * nadie se entere. Por eso cada caso de acá comprueba dos cosas — qué decidió y
 * qué dejó escrito.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ALIAS = 'k7f2mq9xz3@in.ponox.co'
const BANCO = 'alertasynotificaciones@an.notificacionesbancolombia.com'

const correo = (over: Partial<DatosCorreo> = {}) =>
  correoBancolombia({
    plantilla: 'llaves',
    montoTexto: '100,000.00',
    remitente: 'CARLOS RAMIREZ GOMEZ',
    cuentaUltimos4: '4129',
    fecha: '14/08/26',
    hora: '15:32',
    alias: ALIAS,
    ...over,
  })

describe('ingerirCorreo', () => {
  let base: BaseDePrueba
  let tenant: ConfigConciliacion
  const verificador = new VerificadorDeclarado()

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => base.cerrar())

  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'Panadería Doña Luz')
    await base.db.query(
      `UPDATE tenants
          SET email_alias = $2, cuenta_ultimos4 = '4129',
              cuenta_titular = 'ADRIANA PINILLA FERNANDEZ', capacidades = '{conciliacion}'
        WHERE id = $1`,
      [TENANT, ALIAS],
    )
    await base.db.query(
      `INSERT INTO tenant_email_senders (tenant_id, direccion, dkim_dominio_esperado)
       VALUES ($1, $2, 'notificacionesbancolombia.com')`,
      [TENANT, BANCO],
    )
    tenant = (await tenantPorAlias(base.db, ALIAS))!
  })

  const eventos = async () =>
    base.db.query<{ paso: string; decision: string; motivo: string }>(
      `SELECT paso, decision, motivo FROM agent_events WHERE tenant_id = $1 ORDER BY id`,
      [TENANT],
    )

  it('resuelve el tenant por su alias', () => {
    expect(tenant.id).toBe(TENANT)
    expect(tenant.cuentaUltimos4).toBe('4129')
    expect(tenant.remitentes).toEqual([
      { direccion: BANCO, dkimDominioEsperado: 'notificacionesbancolombia.com' },
    ])
  })

  it('guarda el aviso de un correo bueno', async () => {
    const r = await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })

    expect(r.estado).toBe('conciliable')
    expect(r.aviso?.montoCentavos).toBe(10_000_000)
    expect(r.avisoId).not.toBeNull()

    const [guardado] = await base.db.query<{ monto_centavos: string; huella: string }>(
      `SELECT monto_centavos, huella FROM bank_notifications WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(Number(guardado.monto_centavos)).toBe(10_000_000)
    expect(guardado.huella).not.toBe('')
  })

  it('deja la traza de cada paso', async () => {
    await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })

    expect((await eventos()).map((e) => e.paso)).toEqual([
      'correo_recibido',
      'dkim',
      'parse_email',
    ])
  })

  it('manda a cuarentena un correo firmado por otro dominio, y guarda el crudo', async () => {
    // El ataque: el `From` dice Bancolombia y el texto dice que entró plata.
    // Lo que no se puede falsificar es la firma.
    const r = await ingerirCorreo(base.db, {
      tenant,
      crudo: correo({ dkim: 'otroDominio' }),
      verificador,
    })

    expect(r.estado).toBe('cuarentena')
    expect(await contarCuarentena(base.db, TENANT)).toBe(1)
    // Cero avisos: un correo en cuarentena jamás alimenta el cruce.
    expect(await base.db.query('SELECT id FROM bank_notifications')).toHaveLength(0)

    const traza = await eventos()
    expect(traza.at(-1)).toMatchObject({ paso: 'dkim', decision: 'bloqueado' })
  })

  it('manda a cuarentena un correo sin firma', async () => {
    const r = await ingerirCorreo(base.db, {
      tenant,
      crudo: correo({ dkim: 'ausente' }),
      verificador,
    })
    expect(r.estado).toBe('cuarentena')
    expect(r.motivo).toMatch(/no trae firma/i)
  })

  it('manda a cuarentena un remitente que no está en la lista del cliente', async () => {
    const r = await ingerirCorreo(base.db, {
      tenant,
      crudo: correo({ de: 'otro@banco-falso.com' }),
      verificador,
    })

    expect(r.estado).toBe('cuarentena')
    expect(r.motivo).toMatch(/remitente no reconocido/i)
  })

  it('exige la cadena de reenvío', async () => {
    // Un correo inyectado directo al alias no pasó por el Gmail del cliente y
    // no tiene ningún `Received`.
    const sinReenvio = correo().replace(/^Received:.*\r\n/m, '')
    const r = await ingerirCorreo(base.db, { tenant, crudo: sinReenvio, verificador })

    expect(r.estado).toBe('cuarentena')
    expect(r.motivo).toMatch(/cadena de reenv/i)
  })

  it('no procesa dos veces el mismo correo', async () => {
    // La gente reenvía y los MTA reentregan.
    await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })
    const segunda = await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })

    expect(segunda.estado).toBe('duplicado')
    expect(await base.db.query('SELECT id FROM bank_notifications')).toHaveLength(1)
    // Y no vuelve a ensuciar la traza con los mismos pasos.
    expect((await eventos()).filter((e) => e.paso === 'dkim')).toHaveLength(1)
  })

  it('descarta un egreso sin guardarlo', async () => {
    // Menos datos financieros de terceros guardados es menos riesgo, y es lo
    // que se le promete al cliente.
    const egreso = correo().replace(
      /recibiste una transferencia de/,
      'Realizaste una transferencia a',
    )
    const r = await ingerirCorreo(base.db, { tenant, crudo: egreso, verificador })

    expect(r.estado).toBe('descartado')
    expect(r.clasificacion).toBe('egreso')
    expect(await base.db.query('SELECT id FROM raw_emails')).toHaveLength(0)
  })

  it('en desarrollo sí puede guardar lo que no es ingreso', async () => {
    const egreso = correo().replace(
      /recibiste una transferencia de/,
      'Realizaste una transferencia a',
    )
    const r = await ingerirCorreo(base.db, {
      tenant,
      crudo: egreso,
      verificador,
      guardarNoIngresos: true,
    })

    expect(r.estado).toBe('descartado')
    expect(r.rawEmailId).not.toBeNull()
  })

  it('guarda y alerta cuando el banco cambió la redacción', async () => {
    // El correo es auténtico y habla de un ingreso, pero ningún patrón lo lee.
    // Es la falla que se lleva a todos los clientes el mismo día.
    const nuevoFormato = correo().replace(
      /recibiste una transferencia de .*$/m,
      'recibiste una transferencia! Detalle: ANA RUIZ, valor 100.000, cuenta 4129.',
    )
    const r = await ingerirCorreo(base.db, { tenant, crudo: nuevoFormato, verificador })

    expect(r.estado).toBe('sin_parsear')
    expect(r.alerta).toBe(true)

    const [fila] = await base.db.query<{ parse_ok: boolean; cuarentena: boolean }>(
      `SELECT parse_ok, cuarentena FROM raw_emails WHERE tenant_id = $1`,
      [TENANT],
    )
    // No es cuarentena: el correo es legítimo. Es un correo que no supimos leer.
    expect(fila.parse_ok).toBe(false)
    expect(fila.cuarentena).toBe(false)
  })

  it('manda a cuarentena un pago que entró a otra cuenta', async () => {
    const r = await ingerirCorreo(base.db, {
      tenant,
      crudo: correo({ cuentaUltimos4: '9999' }),
      verificador,
    })

    expect(r.estado).toBe('cuarentena')
    expect(r.motivo).toMatch(/no es la del comerciante/i)
    expect(await base.db.query('SELECT id FROM bank_notifications')).toHaveLength(0)
  })

  it('guarda la hora del banco, no la de llegada', async () => {
    // Son dos fechas distintas y la que sirve para cruzar es la del banco. Un
    // correo puede tardar minutos en llegar.
    await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })

    const [fila] = await base.db.query<{ banco_at: Date }>(
      `SELECT banco_at FROM raw_emails WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(new Date(fila.banco_at).toISOString()).toBe('2026-08-14T20:32:00.000Z')
  })

  it('un aviso conciliable deja el aviso listo para cruzar', async () => {
    const r = await ingerirCorreo(base.db, { tenant, crudo: correo(), verificador })
    // Quien llama encola el cruce con esto y no tiene que volver a leer nada.
    expect(r.aviso?.ocurridoEn.toISOString()).toBe('2026-08-14T20:32:00.000Z')
    expect(r.aviso?.remitenteNorm).toBe('CARLOS RAMIREZ GOMEZ')
  })
})
