import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registrarContacto } from './contactos'
import { abrirOReutilizar } from './conversaciones'
import { crearDeudorConObligacion } from './cartera'
import {
  bordesDelMes,
  consumoIaDelPeriodo,
  cupoDelCliente,
  mesesRecientes,
  resumenDelPeriodo,
} from './consumo'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'

/**
 * Las cuentas de la pantalla de Consumo.
 *
 * Los números de estos tests están puestos a mano para poder sumarlos de
 * cabeza. Una agregación que se prueba contra otra agregación no prueba nada.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'

const PERIODO = { desde: '2026-08-01T00:00:00-05:00', hasta: '2026-09-01T00:00:00-05:00' }
const DENTRO = '2026-08-15T10:00:00-05:00'
const ANTES = '2026-07-31T23:00:00-05:00'

describe('resumenDelPeriodo', () => {
  let base: BaseDePrueba
  let conversacionId: string
  let deudorId: string
  let obligacionId: string

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
    // Los cupos viven en `tenant_cobranza`, que es una fila aparte: un tenant
    // puede conciliar y no cobrar. Los valores salen de los DEFAULT de la
    // migración, que son los que la pantalla va a mostrar como verdad.
    await base.db.query(`INSERT INTO tenant_cobranza (tenant_id) VALUES ($1)`, [TENANT])

    const creado = await crearDeudorConObligacion(base.db, TENANT, {
      nombre: 'Ana Ruiz',
      tipoDocumento: 'CC',
      documento: '1020304050',
      telefono: '+573001112233',
      numeroCredito: 'CR-9001',
      saldoTotal: 1_000_000,
      diasMora: 45,
    })
    deudorId = creado.deudorId
    obligacionId = creado.obligacionId
    const hilo = await abrirOReutilizar(base.db, TENANT, {
      deudorId,
      obligacionId,
      ahora: DENTRO,
    })
    conversacionId = hilo.id
  })

  const contacto = (over: Partial<Parameters<typeof registrarContacto>[2]> = {}) =>
    registrarContacto(base.db, TENANT, {
      obligacionId,
      deudorId,
      conversacionId,
      canal: 'whatsapp',
      direccion: 'saliente',
      timestamp: DENTRO,
      cuerpo: 'hola',
      resultado: 'entregado',
      costoCop: 3.2,
      categoria: 'utility',
      proveedor: 'meta',
      ...over,
    })

  it('suma el costo real, con decimales', async () => {
    // COP 3,2 redondeado a entero es cero: mil mensajes valdrían $0 en la
    // pantalla que decide si el canal es rentable.
    await contacto()
    await contacto()
    await contacto()

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.costoCop).toBeCloseTo(9.6, 4)
  })

  it('separa lo que cuesta de lo que consume cupo', async () => {
    // Un entrante no cuesta nada y sí consume cupo. Confundirlos es el error que
    // la cabecera de `planes.ts` advierte: bajar el cupo no evita un costo,
    // cede margen.
    await contacto({ direccion: 'entrante', costoCop: 0, categoria: null })
    await contacto({ categoria: 'servicio', costoCop: 0 })
    await contacto({ categoria: 'marketing', costoCop: 80 })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.costoCop).toBe(80)
    expect(r.mensajesQueCuentan).toBe(3)
  })

  it('los bloqueados no cuestan ni consumen, pero se cuentan aparte', async () => {
    await contacto()
    await contacto({ resultado: 'bloqueado', costoCop: 0, categoria: null, cuerpo: '' })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.mensajesQueCuentan).toBe(1)
    expect(r.bloqueados).toBe(1)
    expect(r.costoCop).toBeCloseTo(3.2, 4)
  })

  it('desglosa por categoría, que es lo que no se podía responder antes', async () => {
    await contacto({ categoria: 'utility', costoCop: 3.2 })
    await contacto({ categoria: 'utility', costoCop: 3.2 })
    await contacto({ categoria: 'marketing', costoCop: 80 })
    await contacto({ categoria: 'servicio', costoCop: 0 })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    const porNombre = Object.fromEntries(r.porCategoria.map((c) => [c.categoria, c]))

    expect(porNombre.marketing.costoCop).toBe(80)
    expect(porNombre.utility.mensajes).toBe(2)
    expect(porNombre.servicio.costoCop).toBe(0)
    // Un solo mensaje de marketing cuesta más que veinticinco utility. Es la
    // cifra que justifica la columna.
    expect(porNombre.marketing.costoCop).toBeGreaterThan(porNombre.utility.costoCop)
  })

  it('los bloqueados no consumen cupo de conversaciones', async () => {
    // El motor abre el hilo ANTES de evaluar el plan, así que un deudor con
    // opt-out genera conversación y contacto bloqueado y nada más. Sin filtrar,
    // esa "conversación" consumía cupo a COP 180 de excedente — tres
    // centímetros debajo del texto de la pantalla que dice que los bloqueados
    // no consumen cupo.
    await contacto({ resultado: 'bloqueado', costoCop: 0, categoria: null, cuerpo: '' })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.mensajesQueCuentan).toBe(0)
    expect(r.bloqueados).toBe(1)
    expect(r.conversaciones).toBe(0)
  })

  it('un envío fallido no diluye el precio por mensaje', async () => {
    // No se entregó y no se cobró. Contándolo, un fallido más un entregado
    // —los dos utility— mostraban COP 1,6 por mensaje: un precio que no existe
    // en ningún rate card, en la columna que el cliente compara contra la
    // factura de Meta.
    await contacto({ resultado: 'fallido', costoCop: 0, categoria: 'utility' })
    await contacto({ resultado: 'entregado', costoCop: 3.2, categoria: 'utility' })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    const utility = r.porCategoria.find((c) => c.categoria === 'utility')!
    expect(utility.mensajes).toBe(1)
    expect(utility.costoCop).toBeCloseTo(3.2, 4)
  })

  it('cuenta el tráfico del proveedor simulado, y es a propósito', async () => {
    // Antes se excluía `proveedor = 'simulado'` para dejar afuera el botón de
    // demo. Filtraba media conversación —el entrante inyectado sí, la respuesta
    // del agente y sus tokens no— y encima `'simulado'` significa dos cosas:
    // `crearProveedores` cae ahí cuando faltan las credenciales de Meta. Un
    // cliente desplegado sin configurar veía la pantalla en cero y parecía un
    // mes tranquilo en vez de una configuración rota.
    await contacto()
    await contacto({ proveedor: 'simulado', costoCop: 3.2, categoria: 'utility' })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.mensajesQueCuentan).toBe(2)
  })

  it('respeta el periodo por los dos bordes', async () => {
    await contacto({ timestamp: ANTES })
    await contacto({ timestamp: DENTRO })
    await contacto({ timestamp: '2026-09-01T00:00:00-05:00' })

    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r.mensajesQueCuentan).toBe(1)
  })

  it('no suma lo de otro cliente', async () => {
    await contacto()

    const r = await resumenDelPeriodo(base.db, OTRO, PERIODO)
    expect(r.costoCop).toBe(0)
    expect(r.mensajesQueCuentan).toBe(0)
  })

  it('un periodo sin nada devuelve ceros, no null', async () => {
    const r = await resumenDelPeriodo(base.db, TENANT, PERIODO)
    expect(r).toMatchObject({ costoCop: 0, mensajesQueCuentan: 0, bloqueados: 0 })
    expect(r.porCategoria).toEqual([])
  })

  describe('consumoIaDelPeriodo', () => {
    const evento = (tokensIn: number, tokensOut: number, latencia: number, en = DENTRO) =>
      base.db.query(
        `INSERT INTO agent_events (tenant_id, paso, decision, motivo, proveedor,
                                   tokens_in, tokens_out, latencia_ms, conversacion_id, created_at)
         VALUES ($1,'cerebro','ok','','modelo',$2,$3,$4,$5,$6)`,
        [TENANT, tokensIn, tokensOut, latencia, conversacionId, en],
      )

    it('cuenta turnos y conversaciones por separado', async () => {
      // El precio se negocia por conversación; el costo se gasta por turno. Esa
      // brecha es exactamente lo que hay que mirar para optimizar.
      await evento(1000, 200, 800)
      await evento(1500, 300, 1200)

      const r = await consumoIaDelPeriodo(base.db, TENANT, PERIODO)
      expect(r.turnos).toBe(2)
      expect(r.conversaciones).toBe(1)
      expect(r.tokensEntrada).toBe(2500)
      expect(r.tokensSalida).toBe(500)
    })

    it('cuenta el turno aunque el proveedor no reporte tokens', async () => {
      // Filtrando por `tokens_in IS NOT NULL`, un turno sin `usage` desaparecía
      // entero — incluido del denominador de turnos por conversación, que es la
      // cifra que se mira para optimizar. El turno ocurrió y costó.
      await base.db.query(
        `INSERT INTO agent_events (tenant_id, paso, decision, motivo, proveedor,
                                   tokens_in, tokens_out, latencia_ms, conversacion_id, created_at)
         VALUES ($1,'cerebro','ok','','modelo',NULL,NULL,900,$2,$3)`,
        [TENANT, conversacionId, DENTRO],
      )

      const r = await consumoIaDelPeriodo(base.db, TENANT, PERIODO)
      expect(r.turnos).toBe(1)
      expect(r.tokensEntrada).toBe(0)
    })

    it('ignora los pasos de la traza, que no consumen tokens', async () => {
      // `agent_events` guarda las dos cosas: qué consultó el agente y qué costó
      // pensar. Sumar los pasos como turnos inflaría el conteo.
      await base.db.query(
        `INSERT INTO agent_events (tenant_id, paso, decision, motivo, conversacion_id, created_at)
         VALUES ($1,'consultarCartera','ok','saldo',$2,$3)`,
        [TENANT, conversacionId, DENTRO],
      )
      await evento(1000, 200, 800)

      const r = await consumoIaDelPeriodo(base.db, TENANT, PERIODO)
      expect(r.turnos).toBe(1)
    })

    it('sin turnos no hay mediana que inventar', async () => {
      const r = await consumoIaDelPeriodo(base.db, TENANT, PERIODO)
      expect(r.turnos).toBe(0)
      expect(r.latenciaMedianaMs).toBeNull()
    })

    it('la mediana es la del medio, no el promedio', async () => {
      // Con un turno lento de 20 s, el promedio miente y la mediana no.
      await evento(100, 10, 500)
      await evento(100, 10, 900)
      await evento(100, 10, 20_000)

      const r = await consumoIaDelPeriodo(base.db, TENANT, PERIODO)
      expect(r.latenciaMedianaMs).toBe(900)
    })
  })

  describe('cupoDelCliente', () => {
    it('lee los dos cubos que vende la cotización', async () => {
      const cupo = await cupoDelCliente(base.db, TENANT)
      // Conversaciones y plantillas se cuentan y se exceden por separado: un
      // solo cubo no puede facturar el excedente que se vendió.
      expect(cupo?.conversacionesMes).toBe(3000)
      expect(cupo?.plantillasMes).toBe(6000)
      expect(cupo?.excedenteConversacionCop).toBe(180)
    })

    it('un tenant sin fila de cobranza devuelve null, no ceros', async () => {
      // Cero cupo y "no configurado" son cosas distintas: la primera diría que
      // el cliente se pasó de un cupo que nunca se le vendió.
      await base.db.query(`DELETE FROM tenant_cobranza WHERE tenant_id = $1`, [TENANT])
      expect(await cupoDelCliente(base.db, TENANT)).toBeNull()
    })
  })
})

describe('el mes como periodo', () => {
  it('corta el mes en hora de Bogotá, no en UTC', () => {
    // Un mensaje del 31 a las ocho de la noche es UTC del día 1. Contarlo en el
    // mes siguiente descuadra la factura contra la del cliente unas horas todos
    // los meses.
    expect(bordesDelMes('2026-08')).toEqual({
      desde: '2026-08-01T00:00:00-05:00',
      hasta: '2026-09-01T00:00:00-05:00',
    })
  })

  it('diciembre pasa al año siguiente', () => {
    expect(bordesDelMes('2026-12')).toEqual({
      desde: '2026-12-01T00:00:00-05:00',
      hasta: '2027-01-01T00:00:00-05:00',
    })
  })

  it('los meses de un dígito llevan cero adelante', () => {
    // Sin el padding la cadena sale `2026-9-01`, que Postgres acepta y ordena
    // distinto: el rango dejaría de cubrir el mes.
    expect(bordesDelMes('2026-09').hasta).toBe('2026-10-01T00:00:00-05:00')
  })

  it('el mes actual es el de Colombia, no el de UTC', () => {
    // 31 de agosto, 20:00 en Bogotá = 1 de septiembre 01:00 UTC. Con `getUTCMonth`
    // el selector marcaba septiembre como mes actual mientras quien mira la
    // pantalla todavía está en agosto — y como los bordes sí se calculan en hora
    // de Bogotá, ese mes "actual" salía vacío.
    const finDeAgostoEnBogota = new Date('2026-08-31T20:00:00-05:00')
    expect(mesesRecientes(finDeAgostoEnBogota)[0]).toBe('2026-08')
  })

  it('devuelve seis meses hacia atrás, sin repetir ni saltear', () => {
    const meses = mesesRecientes(new Date('2026-03-15T12:00:00-05:00'))
    expect(meses).toEqual(['2026-03', '2026-02', '2026-01', '2025-12', '2025-11', '2025-10'])
  })
})
