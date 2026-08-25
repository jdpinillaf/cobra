import { beforeEach, describe, expect, it } from 'vitest'
import type { Acuerdo, Contacto, Deudor, LimitesNegociacion, Obligacion, Pago } from '@/domain/types'
import { crearHerramientas } from '@/agent/herramientas'
import type { PuertoAgente } from '@/agent/puerto'
import { declararFunciones, type AccionEjecutada } from './funciones'
import { abrirPuente, type DiarioDeLlamada, type SalidaTwilio } from './puente'
import { AgenteVozSimulado, GUIONES } from './simulado'
import type { AgenteDeVoz, OpcionesAgente, TurnoVoz } from './agente'
import type { ResumenLlamada } from './resumen'

const DEUDOR: Deudor = {
  id: 'd1', clienteId: 'c1', tipoDocumento: 'CC', documento: '1020304050',
  nombre: 'Jorge Ospina', telefonos: ['+573001234567'], email: null, rol: 'titular',
  consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: null },
  preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
  numeroErradoEn: null,
}
const OBLIGACION: Obligacion = {
  id: 'o1', clienteId: 'c1', deudorId: 'd1', numeroCredito: 'CR-04471',
  capital: 1_760_000, interesMora: 80_000, saldoTotal: 1_840_000,
  fechaVencimiento: '2026-07-13', diasMora: 43, tramo: 'media', estado: 'en_mora',
}
const LIMITES: LimitesNegociacion = {
  descuentoMaxPct: 10, cuotasMax: 4, diasPlazoMax: 30, montoMinimoAbono: 100_000,
}

class PuertoDePrueba implements PuertoAgente {
  readonly deudor = DEUDOR
  readonly obligacion = OBLIGACION
  readonly contactosPrevios: Contacto[] = []
  acuerdoVigente: Acuerdo | null = null
  readonly acuerdos: Acuerdo[] = []
  readonly pagos: Pago[] = []
  humano = false
  bajaEn: string | null = null
  private n = 0
  async guardarAcuerdo(a: Acuerdo) { this.acuerdos.push(a); this.acuerdoVigente = a }
  async guardarPago(p: Pago) { this.pagos.push(p) }
  async tomaUnHumano() { this.humano = true }
  async marcarNumeroErrado() {}
  async registrarBaja(en: string) { this.bajaEn = en; this.humano = true }
  async anotarPaso() {}
  nonce() { return `n${++this.n}` }
  nuevoId(pre: 'acu' | 'pag') { return `${pre}_${++this.n}` }
  async anotarConsumoIa() {}
}

class SalidaDePrueba implements SalidaTwilio {
  readonly enviados: Uint8Array[] = []
  limpiezas = 0
  colgada = false
  enviarMedia(m: Uint8Array) { this.enviados.push(m) }
  limpiar() { this.limpiezas += 1 }
  colgar() { this.colgada = true }
}

class DiarioDePrueba implements DiarioDeLlamada {
  readonly turnos: (TurnoVoz & { indice: number })[] = []
  readonly acciones: (AccionEjecutada & { turnoIndice: number })[] = []
  cierre: { motivo: string; duracionSeg: number; resumen: ResumenLlamada } | null = null
  async anotarTurno(t: TurnoVoz & { indice: number }) { this.turnos.push(t) }
  async marcarInterrumpido(indice: number) {
    const t = this.turnos.find((x) => x.indice === indice)
    if (t) t.interrumpido = true
  }
  async anotarAccion(a: AccionEjecutada & { turnoIndice: number }) { this.acciones.push(a) }
  async cerrar(c: { motivo: string; duracionSeg: number; resumen: ResumenLlamada }) { this.cierre = c }
}

/** El reloj no duerme: el test corre en milisegundos, no en segundos. */
const SIN_ESPERA = { esperar: async () => {} }

let puerto: PuertoDePrueba
let salida: SalidaDePrueba
let diario: DiarioDePrueba
let herramientas: ReturnType<typeof crearHerramientas>

beforeEach(() => {
  puerto = new PuertoDePrueba()
  salida = new SalidaDePrueba()
  diario = new DiarioDePrueba()
  herramientas = crearHerramientas({
    puerto, limites: LIMITES, fechaHoy: '2026-08-25', urlBase: 'https://pagos.ejemplo.co',
  })
})

async function correr(guion: keyof typeof GUIONES) {
  const funciones = await declararFunciones(herramientas)
  const agente = new AgenteVozSimulado(
    GUIONES[guion],
    { deudor: DEUDOR, obligacion: OBLIGACION, limites: LIMITES },
    SIN_ESPERA,
  )
  const puente = await abrirPuente({
    agente, salida, diario, herramientas, funciones,
    prompt: 'prompt de prueba',
    saludo: 'Buenos días, le hablamos de Créditos del Valle. Esta llamada es grabada.',
  })
  // El simulador actúa en microtareas; alcanza con ceder el turno unas veces.
  for (let i = 0; i < 50; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 20))
  return puente
}

describe('abrirPuente con el agente simulado', () => {
  it('cierra un acuerdo y emite el link, ejecutando las herramientas de verdad', async () => {
    const puente = await correr('cuotas')
    await puente.terminar('colgo')

    expect(puerto.acuerdos).toHaveLength(1)
    // Un acuerdo, un cobro. Dos links para el mismo acuerdo serían dos deudas.
    expect(puerto.pagos).toHaveLength(1)
    expect(puerto.acuerdos[0].numeroCuotas).toBeLessThanOrEqual(LIMITES.cuotasMax)

    const nombres = puente.acciones.map((a) => a.nombre)
    expect(nombres).toContain('proponerAcuerdo')
    expect(nombres).toContain('generarLinkDePago')
    expect(puente.acciones.every((a) => a.estado === 'ok')).toBe(true)

    // Todo lo que pasó quedó escrito mientras pasaba, no al final.
    expect(diario.turnos.length).toBe(puente.turnos.length)
    expect(diario.acciones.length).toBe(puente.acciones.length)
    expect(diario.cierre?.resumen.resultado).toBe('acuerdo')
  })

  /** El link no se dicta: la transcripción no puede contener una URL. */
  it('por voz nunca dice la dirección del link en voz alta', async () => {
    const puente = await correr('cuotas')
    await puente.terminar('colgo')
    const dicho = puente.turnos.filter((t) => t.quien === 'agente').map((t) => t.texto).join(' ')
    expect(dicho).not.toMatch(/https?:\/\//)
    expect(dicho).toContain('WhatsApp')
  })

  it('escala cuando el deudor pide más cuotas de las autorizadas', async () => {
    const puente = await correr('escala')
    await puente.terminar('colgo')

    // El agente sí alcanzó a proponer un plan dentro de rango antes de que le
    // pidieran doce cuotas. Lo que importa es que las doce **no** se acordaron
    // y que el caso terminó en manos de una persona.
    expect(puerto.acuerdos.every((a) => a.numeroCuotas <= LIMITES.cuotasMax)).toBe(true)
    expect(puerto.pagos).toHaveLength(0)
    expect(puerto.humano).toBe(true)
    expect(diario.cierre?.resumen.resultado).toBe('escalado')
  })

  /**
   * La regla del buzón. Twilio cobra la llamada que contesta un contestador,
   * porque para la red quedó completada: sin esto se paga el minuto entero
   * por hablarle a una máquina.
   */
  it('cuelga si nadie habla, y lo registra como buzón', async () => {
    // Con un agente que no dice nada: el simulado, sin parlamentos, cierra solo
    // al terminar su guion y nunca dejaría correr al guardia.
    const agente: AgenteDeVoz = {
      nombre: 'mudo',
      async iniciar() {},
      enviarAudio() {},
      responderFuncion() {},
      async cerrar() {},
    }
    // En un objeto y no en un `let`: asignada dentro del callback, TypeScript
    // estrecha la variable a `never` y `disparar()` deja de compilar.
    const guardia: { fn: (() => void) | null } = { fn: null }
    await abrirPuente({
      agente, salida, diario, herramientas, funciones: [], prompt: 'p', saludo: 's',
      // El guardia se captura en vez de esperarlo: el test no duerme ocho segundos.
      programar: (fn, ms) =>
        ms >= 8_000 ? ((guardia.fn = fn), { cancelar: () => { guardia.fn = null } }) : { cancelar: () => {} },
    })

    expect(guardia.fn).not.toBeNull()
    guardia.fn?.()
    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(salida.colgada).toBe(true)
    expect(diario.cierre?.motivo).toBe('buzon')
    expect(diario.cierre?.resumen.resultado).toBe('sin_contacto')
  })
})

describe('la baja la decide el código', () => {
  /**
   * El hueco que encontró una simulación entre dos modelos: el deudor pidió
   * tres veces que no lo llamaran más y el agente escaló a un asesor sin que
   * nadie registrara la revocación. La Ley 2300 no admite eso, y confiar en
   * que el modelo llame una herramienta es confiar en que se acuerde.
   */
  it('registra la revocación y cierra, aunque el modelo no haga nada', async () => {
    let opciones: OpcionesAgente | null = null
    const agente: AgenteDeVoz = {
      nombre: 'mudo',
      async iniciar(o) { opciones = o },
      enviarAudio() {},
      responderFuncion() {},
      async cerrar() {},
    }

    await abrirPuente({
      agente, salida, diario, herramientas, funciones: [],
      prompt: 'p', saludo: 's', puerto,
      programar: () => ({ cancelar: () => {} }),
    })

    opciones!.alTurno({
      quien: 'deudor',
      texto: 'No me vuelvan a escribir, deme de baja',
      msDesdeInicio: 0,
    })
    for (let i = 0; i < 30; i++) await Promise.resolve()

    expect(puerto.bajaEn).not.toBeNull()
    expect(salida.colgada).toBe(true)
    expect(diario.cierre?.motivo).toBe('baja')
    // Y se despide una sola vez, que es justo lo que la persona pidió.
    const despedidas = diario.turnos.filter((t) => t.texto.includes('No le volvemos'))
    expect(despedidas).toHaveLength(1)
  })

  it('no confunde «ya cancelé la cuota» con una baja', async () => {
    let opciones: OpcionesAgente | null = null
    const agente: AgenteDeVoz = {
      nombre: 'mudo',
      async iniciar(o) { opciones = o },
      enviarAudio() {},
      responderFuncion() {},
      async cerrar() {},
    }
    await abrirPuente({
      agente, salida, diario, herramientas, funciones: [],
      prompt: 'p', saludo: 's', puerto,
      programar: () => ({ cancelar: () => {} }),
    })

    opciones!.alTurno({ quien: 'deudor', texto: 'ya cancelé esa cuota la semana pasada', msDesdeInicio: 0 })
    for (let i = 0; i < 30; i++) await Promise.resolve()

    expect(puerto.bajaEn).toBeNull()
    expect(salida.colgada).toBe(false)
  })
})

describe('cierre', () => {
  /**
   * El bug que dejaba las llamadas en `en_curso` para siempre: `alCerrar` llega
   * por callback y se dispara con `void terminar(...)`. Quien llamaba a
   * `terminar()` después veía que ya estaba cerrado y volvía enseguida, sin
   * esperar el `UPDATE`. El proceso moría antes que la escritura.
   */
  it('un segundo `terminar` espera al cierre que ya estaba en vuelo', async () => {
    // En un objeto: asignada dentro del callback, TypeScript la estrecha a
    // `never` y `soltar()` deja de compilar.
    const puerta: { soltar: (() => void) | null } = { soltar: null }
    const lento = new Promise<void>((r) => { puerta.soltar = r })

    const diarioLento: DiarioDeLlamada = {
      async anotarTurno() {},
      async marcarInterrumpido() {},
      async anotarAccion() {},
      async cerrar() { await lento },
    }
    const agente: AgenteDeVoz = {
      nombre: 'manual',
      async iniciar() {},
      enviarAudio() {},
      responderFuncion() {},
      async cerrar() {},
    }

    const puente = await abrirPuente({
      agente, salida, diario: diarioLento, herramientas, funciones: [],
      prompt: 'p', saludo: 's', programar: () => ({ cancelar: () => {} }),
    })

    void puente.terminar('primero')
    let segundoListo = false
    const segundo = puente.terminar('segundo').then(() => { segundoListo = true })

    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(segundoListo).toBe(false)

    puerta.soltar?.()
    await segundo
    expect(segundoListo).toBe(true)
  })
})

describe('barge-in', () => {
  /**
   * El riesgo número uno de la demo: no falla, suena mal. Twilio bufferea todo
   * lo que se le manda, así que limpiar solo su cola no alcanza — si nosotros
   * seguimos empujando lo que ya teníamos troceado, el agente vuelve a hablar
   * encima del deudor medio segundo después.
   */
  it('al interrumpir limpia Twilio y no sale un frame más de ese turno', async () => {
    let opciones: OpcionesAgente | null = null
    const agente: AgenteDeVoz = {
      nombre: 'manual',
      async iniciar(o) { opciones = o },
      enviarAudio() {},
      responderFuncion() {},
      async cerrar() {},
    }

    await abrirPuente({
      agente, salida, diario, herramientas,
      funciones: [], prompt: 'p', saludo: 's',
      programar: () => ({ cancelar: () => {} }),
    })

    opciones!.alTurno({ quien: 'agente', texto: 'Le propongo pagar en cuatro cuotas de…', msDesdeInicio: 0 })
    opciones!.alAudio(new Uint8Array(480))
    const enviadosAntes = salida.enviados.length
    expect(enviadosAntes).toBe(3)

    opciones!.alInterrumpir()

    expect(salida.limpiezas).toBe(1)
    expect(salida.enviados.length).toBe(enviadosAntes)
    expect(diario.turnos.at(-1)?.quien).toBe('agente')
    // La transcripción tiene que decir que la frase se cortó: mostrarla entera
    // miente sobre lo que la persona alcanzó a oír.
    expect(diario.turnos.at(-1)?.interrumpido).toBe(true)
  })
})
