import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProveedorSimulado } from '@/channels/provider'
import { crearDeudorConObligacion } from '@/repo/cobranza/cartera'
import { abrirOReutilizar, pausarAgente } from '@/repo/cobranza/conversaciones'
import { renovarVentana } from '@/repo/cobranza/ventanas'
import { crearBaseDePrueba, type BaseDePrueba } from '@/repo/prueba'
import type { PuertoAgente } from './puerto'
import { responderEntrante } from './responder'

/**
 * El agente contestando sobre la base.
 *
 * Lo que se prueba acá no es que conteste bien —eso es del modelo y del guion—
 * sino **cuándo se calla y qué deja escrito cuando se calla**. Las tres ramas de
 * la compuerta se registran distinto a propósito, y confundirlas ensucia el
 * único reporte que se le muestra a la SIC.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const USUARIO = 'cccccccc-1111-4111-8111-cccccccccccc'

/** Martes 10:00 en Bogotá: dentro de la ventana legal, sin excusas. */
const MARTES = new Date('2026-08-11T10:00:00-05:00')
/** Domingo: la Ley 2300 lo prohíbe sin excepción. */
const DOMINGO = new Date('2026-08-16T10:00:00-05:00')

const DATOS = {
  nombre: 'Ana Ruiz',
  tipoDocumento: 'CC' as const,
  documento: '1020304050',
  telefono: '+573001112233',
  numeroCredito: 'CR-9001',
  saldoTotal: 1_250_000,
  diasMora: 45,
}

describe('responderEntrante', () => {
  let base: BaseDePrueba
  let conversacionId: string
  let deudorId: string
  let proveedor: ProveedorSimulado

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'Ferretería El Tornillo')
    await base.sembrarUsuario(TENANT, USUARIO, 'marcela@tornillo.co')

    const creado = await crearDeudorConObligacion(base.db, TENANT, DATOS)
    deudorId = creado.deudorId
    const hilo = await abrirOReutilizar(base.db, TENANT, {
      deudorId: creado.deudorId,
      obligacionId: creado.obligacionId,
      ahora: MARTES.toISOString(),
    })
    conversacionId = hilo.id
    // El deudor acaba de escribir: la ventana de servicio está abierta.
    await renovarVentana(base.db, TENANT, creado.deudorId, MARTES.toISOString())
    proveedor = new ProveedorSimulado()
  })

  const responder = (ahora: Date = MARTES) =>
    responderEntrante(base.db, {
      tenantId: TENANT,
      conversacionId,
      ahora,
      urlBase: 'https://ponox.co',
      proveedor,
    })

  it('contesta y deja el saliente en el hilo', async () => {
    const r = await responder()

    expect(r.respondio).toBe(true)
    expect(proveedor.enviados).toHaveLength(1)
    expect(proveedor.enviados[0].para).toBe(DATOS.telefono)

    const [saliente] = await base.db.query<{ cuerpo: string; resultado: string }>(
      `SELECT cuerpo, resultado FROM contactos
        WHERE tenant_id = $1 AND direccion = 'saliente'`,
      [TENANT],
    )
    expect(saliente.cuerpo).not.toBe('')
  })

  it('dentro de la ventana de 24 h el mensaje no cuesta', async () => {
    // Es el motivo económico de haber ido a Meta directo. Cobrarlo como
    // `utility` acá inflaría la única pantalla que mide el negocio.
    await responder()

    const [saliente] = await base.db.query<{ costo_cop: string }>(
      `SELECT costo_cop FROM contactos WHERE tenant_id = $1 AND direccion = 'saliente'`,
      [TENANT],
    )
    expect(Number(saliente.costo_cop)).toBe(0)
  })

  it('un domingo sí contesta: responder no es lo mismo que contactar', async () => {
    // Escribí este caso al revés y el código tenía razón. La Ley 2300 limita
    // **cuándo la empresa contacta al deudor** —horario, domingos, festivos,
    // frecuencia—, no si le puede responder a quien acaba de escribirle. Dejar
    // sin respuesta a alguien que pregunta un domingo cómo paga no protege a
    // nadie; solo lo deja esperando.
    //
    // Por eso la compuerta calla únicamente ante las prohibiciones absolutas, y
    // por eso este test vive acá: es la regla más fácil de "arreglar" mal.
    const r = await responder(DOMINGO)

    expect(r.respondio).toBe(true)
    expect(proveedor.enviados).toHaveLength(1)

    const bloqueados = await base.db.query(
      `SELECT id FROM contactos WHERE tenant_id = $1 AND resultado = 'bloqueado'`,
      [TENANT],
    )
    expect(bloqueados).toHaveLength(0)
  })

  it('la obligación cerrada sí lo calla, y deja el bloqueo escrito', async () => {
    // Ésta sí es absoluta: perseguir lo que ya está pagado es hostigamiento,
    // aunque el deudor haya escrito hace un minuto.
    await base.db.query(`UPDATE obligaciones SET estado = 'pagada' WHERE tenant_id = $1`, [TENANT])

    const r = await responder()

    expect(r.respondio).toBe(false)
    expect(proveedor.enviados).toHaveLength(0)

    // El bloqueo legal **sí** se escribe: es la prueba documental de que el
    // sistema respetó la ley en vez de limitarse a no dejar rastro.
    const [bloqueado] = await base.db.query<{ motivo_bloqueo: string; cuerpo: string }>(
      `SELECT motivo_bloqueo, cuerpo FROM contactos
        WHERE tenant_id = $1 AND resultado = 'bloqueado'`,
      [TENANT],
    )
    expect(bloqueado.motivo_bloqueo).toContain('obligacion_cerrada')
    expect(bloqueado.cuerpo).toBe('')

    // Y el paso en la traza, igual que en la demo. Sin él la consola muestra un
    // hueco en la conversación sin decir por qué.
    const [paso] = await base.db.query<{ paso: string; decision: string }>(
      `SELECT paso, decision FROM agent_events WHERE tenant_id = $1 AND paso = 'guardLey2300'`,
      [TENANT],
    )
    expect(paso.decision).toBe('bloqueado')
  })

  it('con el agente pausado no llama al modelo ni escribe nada', async () => {
    await pausarAgente(base.db, TENANT, conversacionId, {
      usuarioId: USUARIO,
      motivo: 'Lo manejo yo',
    })

    const r = await responder()

    expect(r.respondio).toBe(false)
    if (r.respondio) return
    expect(r.razon).toBe('pausa')
    expect(proveedor.enviados).toHaveLength(0)

    // Ni un bloqueado. Una pausa no es un intento de contacto: escribirla
    // inventaría evidencia y mezclaría una decisión operativa con una
    // obligación de ley en el mismo reporte.
    const filas = await base.db.query(`SELECT id FROM contactos WHERE tenant_id = $1`, [TENANT])
    expect(filas).toHaveLength(0)
  })

  it('a quien pidió la baja no le escribe, aunque acabe de escribir', async () => {
    await base.db.query(
      `UPDATE deudores SET revocado_en = $2 WHERE tenant_id = $1`,
      [TENANT, MARTES.toISOString()],
    )

    const r = await responder()

    expect(r.respondio).toBe(false)
    expect(proveedor.enviados).toHaveLength(0)
  })

  it('a quien dijo que el número no es suyo tampoco', async () => {
    await base.db.query(
      `UPDATE deudores SET numero_errado_en = $2 WHERE tenant_id = $1`,
      [TENANT, MARTES.toISOString()],
    )

    const r = await responder()

    expect(r.respondio).toBe(false)
    expect(proveedor.enviados).toHaveLength(0)
  })

  it('deja la traza en agent_events, que es lo que se le muestra al cliente', async () => {
    await responder()

    const eventos = await base.db.query<{ paso: string; conversacion_id: string }>(
      `SELECT paso, conversacion_id FROM agent_events WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(eventos.length).toBeGreaterThan(0)
    expect(eventos.every((e) => e.conversacion_id === conversacionId)).toBe(true)
  })

  it('sin obligación que gestionar se calla y no inventa nada', async () => {
    // El deudor terminó de pagar y escribe. No hay nada que cobrar: es un caso
    // para una persona.
    await base.db.query(`UPDATE conversaciones SET obligacion_id = NULL WHERE tenant_id = $1`, [
      TENANT,
    ])

    const r = await responder()

    expect(r.respondio).toBe(false)
    if (r.respondio) return
    expect(r.razon).toBe('sin_obligacion')
    expect(proveedor.enviados).toHaveLength(0)
  })

  it('no toca la conversación de otro cliente', async () => {
    const OTRO = '22222222-2222-4222-8222-222222222222'
    await base.sembrarTenant(OTRO, 'Distribuidora Andina')

    const r = await responderEntrante(base.db, {
      tenantId: OTRO,
      conversacionId,
      urlBase: 'https://ponox.co',
      proveedor,
    })

    expect(r.respondio).toBe(false)
    expect(proveedor.enviados).toHaveLength(0)
    void deudorId
  })

  it('un acuerdo deja la obligación en acuerdo_vigente, que es lo que frena la cadencia', async () => {
    // Las dos escrituras van en la misma transacción. El UPDATE no es
    // contabilidad: es lo que hace que el guard responda `acuerdo_vigente`. Un
    // acuerdo guardado sin él deja un deudor que ya acordó y un motor que le
    // sigue escribiendo.
    const { PuertoPostgres } = await import('./puerto-pg')
    const { cargarContexto } = await import('@/repo/cobranza/contexto')

    const [obl] = await base.db.query<{ id: string }>(
      `SELECT id FROM obligaciones WHERE tenant_id = $1`,
      [TENANT],
    )
    const ctx = (await cargarContexto(base.db, TENANT, obl.id))!
    // Tipado como el puerto y no como la implementación: lo que se prueba es el
    // contrato, que es lo que las herramientas del agente ven.
    const puerto: PuertoAgente = new PuertoPostgres(
      base.db,
      TENANT,
      conversacionId,
      ctx.deudor,
      ctx.obligacion,
      [],
      null,
    )

    await puerto.guardarAcuerdo({
      id: puerto.nuevoId('acu'),
      clienteId: TENANT,
      obligacionId: obl.id,
      tipo: 'cuotas',
      montoAcordado: 1_200_000,
      descuentoPct: 0,
      numeroCuotas: 3,
      primeraCuotaEl: '2026-08-20',
      estado: 'aprobado',
      propuestoEn: MARTES.toISOString(),
      aprobadoPor: null,
      aprobadoEn: MARTES.toISOString(),
      motivoRechazo: null,
    })

    const [despues] = await base.db.query<{ estado: string }>(
      `SELECT estado FROM obligaciones WHERE tenant_id = $1 AND id = $2`,
      [TENANT, obl.id],
    )
    expect(despues.estado).toBe('acuerdo_vigente')

    const [guardado] = await base.db.query<{ monto_acordado_centavos: string }>(
      `SELECT monto_acordado_centavos FROM acuerdos WHERE tenant_id = $1`,
      [TENANT],
    )
    // El dominio trabaja en pesos y el esquema en centavos. Confundirlos son dos
    // órdenes de magnitud en un acuerdo de pago.
    expect(Number(guardado.monto_acordado_centavos)).toBe(120_000_000)
  })

  it('la cartera castigada también queda frenada al acordar', async () => {
    // `castigada` no es cartera cerrada: es donde más se negocia, porque el
    // cliente autoriza 50 % de descuento y 12 cuotas ahí. Estaba en el `NOT IN`
    // del UPDATE, así que el acuerdo se escribía, la obligación seguía en
    // `castigada`, el guard no la frenaba —`castigada` no es motivo de
    // bloqueo— y el motor le seguía escribiendo al que acababa de acordar.
    const { PuertoPostgres } = await import('./puerto-pg')
    const { cargarContexto } = await import('@/repo/cobranza/contexto')

    await base.db.query(`UPDATE obligaciones SET estado = 'castigada' WHERE tenant_id = $1`, [
      TENANT,
    ])
    const [obl] = await base.db.query<{ id: string }>(
      `SELECT id FROM obligaciones WHERE tenant_id = $1`,
      [TENANT],
    )
    const ctx = (await cargarContexto(base.db, TENANT, obl.id))!
    const puerto: PuertoAgente = new PuertoPostgres(
      base.db,
      TENANT,
      conversacionId,
      ctx.deudor,
      ctx.obligacion,
      [],
      null,
    )

    await puerto.guardarAcuerdo({
      id: puerto.nuevoId('acu'),
      clienteId: TENANT,
      obligacionId: obl.id,
      tipo: 'cuotas',
      montoAcordado: 600_000,
      descuentoPct: 50,
      numeroCuotas: 12,
      primeraCuotaEl: '2026-08-20',
      estado: 'aprobado',
      propuestoEn: MARTES.toISOString(),
      aprobadoPor: null,
      aprobadoEn: MARTES.toISOString(),
      motivoRechazo: null,
    })

    const [despues] = await base.db.query<{ estado: string }>(
      `SELECT estado FROM obligaciones WHERE tenant_id = $1 AND id = $2`,
      [TENANT, obl.id],
    )
    expect(despues.estado).toBe('acuerdo_vigente')
  })

  it('lo que sí está cerrado no se reabre por un acuerdo', async () => {
    // Una obligación pagada o en jurídico no vuelve a `acuerdo_vigente`: el
    // caso salió del agente y reabrirlo lo devolvería a la cadencia.
    const { PuertoPostgres } = await import('./puerto-pg')
    const { cargarContexto } = await import('@/repo/cobranza/contexto')

    const [obl] = await base.db.query<{ id: string }>(
      `SELECT id FROM obligaciones WHERE tenant_id = $1`,
      [TENANT],
    )
    const ctx = (await cargarContexto(base.db, TENANT, obl.id))!
    await base.db.query(`UPDATE obligaciones SET estado = 'juridico' WHERE tenant_id = $1`, [
      TENANT,
    ])

    const puerto: PuertoAgente = new PuertoPostgres(
      base.db,
      TENANT,
      conversacionId,
      ctx.deudor,
      ctx.obligacion,
      [],
      null,
    )
    await puerto.guardarAcuerdo({
      id: puerto.nuevoId('acu'),
      clienteId: TENANT,
      obligacionId: obl.id,
      tipo: 'cuotas',
      montoAcordado: 100_000,
      descuentoPct: 0,
      numeroCuotas: 1,
      primeraCuotaEl: '2026-08-20',
      estado: 'aprobado',
      propuestoEn: MARTES.toISOString(),
      aprobadoPor: null,
      aprobadoEn: MARTES.toISOString(),
      motivoRechazo: null,
    })

    const [despues] = await base.db.query<{ estado: string }>(
      `SELECT estado FROM obligaciones WHERE tenant_id = $1 AND id = $2`,
      [TENANT, obl.id],
    )
    expect(despues.estado).toBe('juridico')
  })
})
