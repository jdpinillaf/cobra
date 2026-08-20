import { appendFileSync } from 'node:fs'
const L = (...a: unknown[]) => appendFileSync('/tmp/rev.txt', a.map(String).join(' ') + '\n')
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProveedorSimulado } from '@/channels/provider'
import { ejecutarPaso } from '@/cadence/motor'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import { registrarContacto } from './contactos'
import { abrirOReutilizar } from './conversaciones'
import { crearDeudorConObligacion } from './cartera'
import { bordesDelMes, mesesRecientes, resumenDelPeriodo } from './consumo'

const TENANT = '11111111-1111-4111-8111-111111111111'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const MARTES_10AM = new Date('2026-08-11T10:00:00-05:00')
const PERIODO = { desde: '2026-08-01T00:00:00-05:00', hasta: '2026-09-01T00:00:00-05:00' }
const DENTRO = '2026-08-15T10:00:00-05:00'

describe('SCRATCH', () => {
  let base: BaseDePrueba
  beforeAll(async () => { base = await crearBaseDePrueba() })
  afterAll(async () => { await base.cerrar() })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'X')
    await base.db.query(`INSERT INTO tenant_cobranza (tenant_id) VALUES ($1)`, [TENANT])
  })

  it('A. cadencia: qué categoria queda escrita', async () => {
    await base.sembrarDeudorConObligacion(TENANT, DEUDOR, OBLIGACION)
    await base.db.query(
      `INSERT INTO cadencias (tenant_id, tramo, pasos, activa) VALUES ($1,'media',$2,true)`,
      [TENANT, JSON.stringify([{ offsetDias: 5, canal: 'whatsapp', plantillaId: null, fallbackSms: false }])],
    )
    const proveedores = { whatsapp: new ProveedorSimulado(), sms: new ProveedorSimulado() }
    const r = await ejecutarPaso(base.db, TENANT, { obligacionId: OBLIGACION, indice: 0, ahora: MARTES_10AM, proveedores })
    L('  paso ->', JSON.stringify(r))
    const filas = await base.db.query(
      `SELECT categoria, costo_cop, resultado, canal, proveedor FROM contactos WHERE tenant_id=$1`, [TENANT])
    L('  contactos ->', JSON.stringify(filas))

    const res = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    L('  costo total ->', res.costoCop, ' porCategoria ->', JSON.stringify(res.porCategoria))
    const plantillas = res.porCategoria.filter(c => c.categoria !== 'servicio').reduce((s,c)=>s+c.mensajes,0)
    L('  plantillas (cupo) ->', plantillas)
  })

  it('B. conversación cuyo único contacto del mes fue bloqueado', async () => {
    const creado = await crearDeudorConObligacion(base.db, TENANT, {
      nombre: 'Ana', tipoDocumento: 'CC', documento: '1', telefono: '+573001112233',
      numeroCredito: 'CR-1', saldoTotal: 1000, diasMora: 45,
    })
    const hilo = await abrirOReutilizar(base.db, TENANT, { deudorId: creado.deudorId, obligacionId: creado.obligacionId, ahora: DENTRO })
    await registrarContacto(base.db, TENANT, {
      obligacionId: creado.obligacionId, deudorId: creado.deudorId, conversacionId: hilo.id,
      canal: 'whatsapp', direccion: 'saliente', timestamp: DENTRO, cuerpo: '',
      resultado: 'bloqueado', costoCop: 0, categoria: null, proveedor: null,
    })
    const res = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    L('  mensajesQueCuentan=', res.mensajesQueCuentan, ' bloqueados=', res.bloqueados, ' conversaciones=', res.conversaciones)
  })

  it('C. fallido con categoria', async () => {
    const creado = await crearDeudorConObligacion(base.db, TENANT, {
      nombre: 'Ana', tipoDocumento: 'CC', documento: '2', telefono: '+573001112244',
      numeroCredito: 'CR-2', saldoTotal: 1000, diasMora: 45,
    })
    const hilo = await abrirOReutilizar(base.db, TENANT, { deudorId: creado.deudorId, obligacionId: creado.obligacionId, ahora: DENTRO })
    const base3 = { obligacionId: creado.obligacionId, deudorId: creado.deudorId, conversacionId: hilo.id,
      canal: 'whatsapp' as const, direccion: 'saliente' as const, timestamp: DENTRO, cuerpo: 'x', proveedor: 'meta' }
    await registrarContacto(base.db, TENANT, { ...base3, resultado: 'fallido', costoCop: 0, categoria: 'utility' })
    await registrarContacto(base.db, TENANT, { ...base3, resultado: 'encolado', costoCop: 3.2, categoria: 'utility' })
    const res = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    L('  cuentan=', res.mensajesQueCuentan, ' porCategoria=', JSON.stringify(res.porCategoria))
    L('  unitario mostrado =', (res.porCategoria[0].costoCop / res.porCategoria[0].mensajes).toFixed(1))
  })

  it('D. numeric: suma grande y tipo del driver', async () => {
    const creado = await crearDeudorConObligacion(base.db, TENANT, {
      nombre: 'Ana', tipoDocumento: 'CC', documento: '3', telefono: '+573001112255',
      numeroCredito: 'CR-3', saldoTotal: 1000, diasMora: 45,
    })
    const hilo = await abrirOReutilizar(base.db, TENANT, { deudorId: creado.deudorId, obligacionId: creado.obligacionId, ahora: DENTRO })
    for (let i = 0; i < 5; i++) {
      await registrarContacto(base.db, TENANT, { obligacionId: creado.obligacionId, deudorId: creado.deudorId,
        conversacionId: hilo.id, canal: 'whatsapp', direccion: 'saliente', timestamp: DENTRO, cuerpo: 'x',
        resultado: 'entregado', costoCop: 3.2, categoria: 'utility', proveedor: 'meta' })
    }
    const crudo = await base.db.query<{ costo: unknown }>(
      `SELECT COALESCE(SUM(costo_cop),0) AS costo FROM contactos WHERE tenant_id=$1`, [TENANT])
    L('  driver devuelve ->', typeof crudo[0].costo, JSON.stringify(crudo[0].costo))
    const res = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    L('  costoCop =', res.costoCop, ' Math.round =', Math.round(res.costoCop))
  })

  it('E. bordes y selector de meses', () => {
    for (const m of ['2026-12', '2026-01', '2026-09', '2027-02']) {
      L(`  bordesDelMes(${m}) ->`, JSON.stringify(bordesDelMes(m)))
    }
    // 31 dic 21:00 Bogotá = 1 ene 02:00 UTC
    L('  mesesRecientes(2027-01-01T02:00Z) ->', mesesRecientes(new Date('2027-01-01T02:00:00Z')).join(' '))
    L('  mesesRecientes(2026-08-01T02:00Z) ->', mesesRecientes(new Date('2026-08-01T02:00:00Z')).join(' '))
    L('  mesesRecientes(2026-08-31T23:00Z) ->', mesesRecientes(new Date('2026-08-31T23:00:00Z')).join(' '))
    // ¿el mes actual entero está cubierto? el borde 'hasta' del mes actual es futuro: ok
  })
})
