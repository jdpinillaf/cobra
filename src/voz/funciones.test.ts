import { beforeEach, describe, expect, it } from 'vitest'
import type {
  Acuerdo,
  Contacto,
  Deudor,
  LimitesNegociacion,
  Obligacion,
  Pago,
} from '@/domain/types'
import type { PasoTraza } from '@/demo/estado'
import { crearHerramientas, type ContextoHerramientas } from '@/agent/herramientas'
import type { PuertoAgente } from '@/agent/puerto'
import { declararFunciones, ejecutarFuncion } from './funciones'

function unDeudor(over: Partial<Deudor> = {}): Deudor {
  return {
    id: 'd1',
    clienteId: 'c1',
    tipoDocumento: 'CC',
    documento: '1020304050',
    nombre: 'Jorge Ospina',
    telefonos: ['+573001234567'],
    email: null,
    rol: 'titular',
    consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: null },
    preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
    numeroErradoEn: null,
    ...over,
  }
}

function unaObligacion(over: Partial<Obligacion> = {}): Obligacion {
  return {
    id: 'o1',
    clienteId: 'c1',
    deudorId: 'd1',
    numeroCredito: 'CR-04471',
    capital: 1_760_000,
    interesMora: 80_000,
    saldoTotal: 1_840_000,
    fechaVencimiento: '2026-07-13',
    diasMora: 43,
    tramo: 'media',
    estado: 'en_mora',
    ...over,
  }
}

/** El doble más chico que satisface el puerto: acumula, no valida. */
class PuertoDePrueba implements PuertoAgente {
  readonly deudor = unDeudor()
  readonly obligacion = unaObligacion()
  readonly contactosPrevios: Contacto[] = []
  acuerdoVigente: Acuerdo | null = null
  readonly acuerdos: Acuerdo[] = []
  readonly pagos: Pago[] = []
  readonly pasos: Omit<PasoTraza, 'id' | 'ts'>[] = []
  humano = false
  erradoEn: string | null = null
  bajaEn: string | null = null
  private n = 0

  async guardarAcuerdo(a: Acuerdo) { this.acuerdos.push(a); this.acuerdoVigente = a }
  async guardarPago(p: Pago) { this.pagos.push(p) }
  async tomaUnHumano() { this.humano = true }
  async marcarNumeroErrado(en: string) { this.erradoEn = en }
  async registrarBaja(en: string) { this.bajaEn = en }
  async anotarPaso(paso: Omit<PasoTraza, 'id' | 'ts'>) { this.pasos.push(paso) }
  nonce() { return `n${++this.n}` }
  nuevoId(prefijo: 'acu' | 'pag') { return `${prefijo}_${++this.n}` }
  async anotarConsumoIa() {}
}

/** Los del tramo `media` de la demo: 10 % de descuento, hasta 4 cuotas. */
const LIMITES: LimitesNegociacion = {
  descuentoMaxPct: 10,
  cuotasMax: 4,
  diasPlazoMax: 30,
  montoMinimoAbono: 100_000,
}

let puerto: PuertoDePrueba
let herramientas: ReturnType<typeof crearHerramientas>

beforeEach(() => {
  puerto = new PuertoDePrueba()
  const ctx: ContextoHerramientas = {
    puerto,
    limites: LIMITES,
    fechaHoy: '2026-08-25',
    urlBase: 'https://pagos.ejemplo.co',
  }
  herramientas = crearHerramientas(ctx)
})

describe('declararFunciones', () => {
  it('declara las seis, sin `client_side` ni `endpoint`', async () => {
    const fs = await declararFunciones(herramientas)
    expect(fs.map((f) => f.name).sort()).toEqual([
      'consultarCartera',
      'consultarPoliticas',
      'escalarAHumano',
      'generarLinkDePago',
      'marcarNumeroErrado',
      'proponerAcuerdo',
    ])
    /**
     * `client_side` **no** se declara: Deepgram lo devuelve dentro del
     * `FunctionCallRequest`, y mandarlo en `Settings` hace que rechace la
     * conexión con `UNPARSABLE_CLIENT_MESSAGE`. Una función sin `endpoint` ya
     * es del lado del cliente, que es lo que mantiene la aprobación en el
     * código y no en el modelo.
     */
    expect(fs.every((f) => !('client_side' in f))).toBe(true)
    expect(fs.every((f) => !('endpoint' in f))).toBe(true)
  })

  it('deriva los parámetros del zod, sin `$schema`', async () => {
    const [prop] = (await declararFunciones(herramientas, ['proponerAcuerdo']))
    expect(prop.parameters).not.toHaveProperty('$schema')
    const props = (prop.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['tipo', 'montoAcordado', 'numeroCuotas', 'primeraCuotaEl']),
    )
    expect(prop.description.length).toBeGreaterThan(10)
  })
})

describe('ejecutarFuncion', () => {
  it('ejecuta y devuelve contenido serializable', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc1',
      name: 'consultarCartera',
      arguments: JSON.stringify({ motivo: 'verificar saldo antes de proponer' }),
    })
    expect(r.estado).toBe('ok')
    expect(JSON.parse(r.contenido)).toMatchObject({ saldoTotal: 1_840_000, diasMora: 43 })
    expect(puerto.pasos).toHaveLength(1)
  })

  /**
   * El caso que justifica todo el diseño. `montoAcordado` llega como texto
   * —por voz pasa: el modelo transcribe «un millón»— y sin la re-validación
   * entraría a `Math.round(monto / cuotas)` y escribiría `NaN` en la base.
   */
  it('rechaza argumentos que no cumplen el zod, y no escribe nada', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc2',
      name: 'proponerAcuerdo',
      arguments: JSON.stringify({
        tipo: 'cuotas',
        montoAcordado: 'un millón ochocientos',
        numeroCuotas: 4,
        primeraCuotaEl: '2026-08-25',
      }),
    })
    expect(r.estado).toBe('error')
    expect(JSON.parse(r.contenido).error).toBe('argumentos_invalidos')
    expect(puerto.acuerdos).toHaveLength(0)
  })

  it('sobrevive a un JSON roto', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc3',
      name: 'consultarCartera',
      arguments: '{"motivo": "se corto',
    })
    expect(r.estado).toBe('error')
    expect(r.contenido).toContain('argumentos_invalidos')
  })

  it('sobrevive a una herramienta que no existe', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc4',
      name: 'condonarTodo',
      arguments: '{}',
    })
    expect(r.estado).toBe('error')
    expect(JSON.parse(r.contenido).error).toBe('herramienta_desconocida')
  })

  /**
   * `bloqueado` no es un error: la herramienta corrió y dijo que no. La
   * pantalla lo distingue de «se rompió», y es lo que prueba que los límites
   * del cliente mandan sobre el modelo.
   */
  it('marca `bloqueado` cuando el acuerdo se sale de los límites', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc5',
      name: 'proponerAcuerdo',
      arguments: JSON.stringify({
        tipo: 'cuotas',
        montoAcordado: 1_840_000,
        numeroCuotas: 12, // el cliente autorizó 4
        descuentoPct: 0,
        primeraCuotaEl: '2026-08-25',
      }),
    })
    expect(r.estado).toBe('bloqueado')
    expect(puerto.acuerdos).toHaveLength(0)
  })

  it('acepta un acuerdo dentro de los límites y lo escribe', async () => {
    const r = await ejecutarFuncion(herramientas, {
      id: 'fc6',
      name: 'proponerAcuerdo',
      arguments: JSON.stringify({
        tipo: 'cuotas',
        montoAcordado: 1_840_000,
        numeroCuotas: 4,
        descuentoPct: 0,
        primeraCuotaEl: '2026-08-25',
      }),
    })
    expect(r.estado).toBe('ok')
    expect(puerto.acuerdos).toHaveLength(1)
    expect(r.latenciaMs).toBeGreaterThanOrEqual(0)
  })

  it('nunca lanza: un fallo de la herramienta vuelve como respuesta', async () => {
    const rotas = {
      explota: {
        description: 'siempre falla',
        inputSchema: herramientas.consultarCartera.inputSchema,
        execute: async () => { throw new Error('se cayó la base') },
      },
    } as unknown as typeof herramientas
    const r = await ejecutarFuncion(rotas, {
      id: 'fc7',
      name: 'explota',
      arguments: JSON.stringify({ motivo: 'x' }),
    })
    expect(r.estado).toBe('error')
    expect(JSON.parse(r.contenido).detalle).toContain('se cayó la base')
  })
})
