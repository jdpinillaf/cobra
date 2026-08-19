import { describe, expect, it } from 'vitest'
import {
  CASOS,
  CADENCIA,
  DURACION_MS,
  GUION,
  HERRAMIENTAS,
  MS_POR_CARACTER,
  duracionEscritura,
  faseDe,
  reducir,
} from './guion'

describe('duracionEscritura', () => {
  it('es determinista y crece con el texto', () => {
    expect(duracionEscritura('abc')).toBe(duracionEscritura('abc'))
    expect(duracionEscritura('abcd')).toBeGreaterThan(duracionEscritura('abc'))
  })

  it('cobra pausa extra por puntuación', () => {
    expect(duracionEscritura('ab.')).toBeGreaterThan(duracionEscritura('abc'))
  })

  /**
   * La invariante que impide que una línea se corte a media palabra: el bucle
   * de tecleo avanza a `MS_POR_CARACTER` plano, así que tiene que terminar
   * antes de que el timer global pase al evento siguiente.
   */
  it('deja holgura sobre el tecleo plano de cada evento', () => {
    for (const e of GUION) {
      if (e.tipo !== 'escribe') continue
      expect(e.espera).toBeGreaterThan(e.texto.length * MS_POR_CARACTER)
    }
  })
})

describe('faseDe', () => {
  it('el guion arranca en configuración y termina en operación', () => {
    expect(faseDe(GUION[0])).toBe('configuracion')
    expect(faseDe(GUION[GUION.length - 1])).toBe('operacion')
  })

  it('las fases no se intercalan: una sola frontera', () => {
    const fases = GUION.map(faseDe)
    const corte = fases.indexOf('operacion')
    expect(corte).toBeGreaterThan(0)
    expect(fases.slice(0, corte).every((f) => f === 'configuracion')).toBe(true)
    expect(fases.slice(corte).every((f) => f === 'operacion')).toBe(true)
  })
})

describe('reducir', () => {
  it('sin eventos devuelve un tablero vacío', () => {
    const t = reducir([])
    expect(t.instruccion).toEqual([])
    expect(t.casos).toEqual([])
    expect(t.abierto).toBeNull()
    expect(t.recaudadoCop).toBe(0)
    expect(t.desplegando).toBe(false)
  })

  it('el estado final tiene todo lo que el guion promete', () => {
    const t = reducir(GUION)

    expect(t.instruccion).toHaveLength(4)
    expect(t.cadencia).toEqual(CADENCIA)
    expect(t.herramientas).toEqual(HERRAMIENTAS)
    expect(t.desplegando).toBe(true)
    expect(t.casos).toHaveLength(CASOS.length)
    expect(t.abierto).toBe('CR-00412')
    expect(t.recaudadoCop).toBeGreaterThan(0)
  })

  it('los contadores son monótonos en todo prefijo', () => {
    let anterior = reducir([])
    for (let n = 1; n <= GUION.length; n += 1) {
      const t = reducir(GUION.slice(0, n))
      expect(t.instruccion.length).toBeGreaterThanOrEqual(anterior.instruccion.length)
      expect(t.cadencia.length).toBeGreaterThanOrEqual(anterior.cadencia.length)
      expect(t.herramientas.length).toBeGreaterThanOrEqual(anterior.herramientas.length)
      expect(t.casos.length).toBeGreaterThanOrEqual(anterior.casos.length)
      expect(t.recaudadoCop).toBeGreaterThanOrEqual(anterior.recaudadoCop)
      anterior = t
    }
  })

  /** Si `abierto` apuntara a un caso que no está en la cola, el panel queda en blanco. */
  it('el caso abierto siempre está en la cola', () => {
    for (let n = 1; n <= GUION.length; n += 1) {
      const t = reducir(GUION.slice(0, n))
      if (t.abierto === null) continue
      expect(t.casos.some((f) => f.caso.id === t.abierto)).toBe(true)
    }
  })

  it('la cola no crece una vez cargada: los casos cambian de estado en su sitio', () => {
    const t = reducir(GUION)
    const ids = t.casos.map((f) => f.caso.id)
    expect(ids).toEqual(CASOS.map((c) => c.id))
  })

  it('todo avance apunta a un caso que existe', () => {
    const ids = new Set(CASOS.map((c) => c.id))
    for (const e of GUION) {
      if (e.tipo === 'avance' || e.tipo === 'abre') expect(ids.has(e.caso)).toBe(true)
    }
  })

  it('deja como mucho un indicador de escritura, y solo al final del hilo', () => {
    for (let n = 1; n <= GUION.length; n += 1) {
      const { conversacion } = reducir(GUION.slice(0, n))
      const escribiendo = conversacion.filter((e) => e.tipo === 'escribiendo')
      expect(escribiendo.length).toBeLessThanOrEqual(1)
      if (escribiendo.length === 1) {
        expect(conversacion[conversacion.length - 1]?.tipo).toBe('escribiendo')
      }
    }
  })

  it('lo recaudado coincide con la suma de los pagos del guion', () => {
    const pagos = GUION.filter((e) => e.tipo === 'pago')
    const suma = pagos.reduce((s, e) => s + (e.tipo === 'pago' ? e.montoCop : 0), 0)
    expect(reducir(GUION).recaudadoCop).toBe(suma)
  })
})

describe('presupuesto de tiempo', () => {
  /**
   * Una demo que no cabe en la atención de un visitante no es una demo. El tope
   * baja a 22 s a propósito: si alguien agrega beats, el test avisa antes de que
   * el ciclo vuelva a estirarse.
   */
  it('el ciclo completo se mantiene por debajo de 22 s', () => {
    expect(DURACION_MS).toBeLessThan(22_000)
  })

  it('la operación no se come más de 13 s del total', () => {
    const operacion = GUION.filter((e) => faseDe(e) === 'operacion').reduce(
      (s, e) => s + e.espera,
      0,
    )
    expect(operacion).toBeLessThan(13_000)
  })

  /** El acto de configuración es el que más rápido tiene que ir: es el gancho. */
  it('la configuración no se come más de 8 s del total', () => {
    const config = GUION.filter((e) => faseDe(e) === 'configuracion').reduce(
      (s, e) => s + e.espera,
      0,
    )
    expect(config).toBeLessThan(8_000)
  })
})
