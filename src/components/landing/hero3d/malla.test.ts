import { describe, expect, it } from 'vitest'
import {
  CANTIDAD_NODOS,
  NODOS_ESPINA,
  RADIO,
  SLOTS_ICONO,
  construirEspina,
  construirMalla,
  proyectar,
} from './malla'

describe('construirMalla', () => {
  const malla = construirMalla()

  it('devuelve tres coordenadas por nodo', () => {
    expect(malla.posiciones).toHaveLength(CANTIDAD_NODOS * 3)
  })

  /** Si un nodo se escapa, la figura no cabe en el encuadre de la cámara. */
  it('mantiene todos los nodos dentro del radio, con el margen del jitter', () => {
    for (let i = 0; i < CANTIDAD_NODOS; i += 1) {
      const d = Math.hypot(
        malla.posiciones[i * 3],
        malla.posiciones[i * 3 + 1],
        malla.posiciones[i * 3 + 2],
      )
      expect(d).toBeLessThanOrEqual(RADIO * 1.15)
    }
  })

  it('no genera aristas reflexivas ni repetidas', () => {
    const claves = malla.aristas.map(([a, b]) => `${a}-${b}`)
    expect(new Set(claves).size).toBe(claves.length)
    for (const [a, b] of malla.aristas) expect(a).not.toBe(b)
  })

  it('todos los índices de arista apuntan a un nodo que existe', () => {
    for (const [a, b] of malla.aristas) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(CANTIDAD_NODOS)
    }
  })

  it('siempre guarda el par en orden ascendente', () => {
    for (const [a, b] of malla.aristas) expect(a).toBeLessThan(b)
  })

  it('conecta cada nodo con algo: nadie queda suelto', () => {
    const conectados = new Set(malla.aristas.flat())
    expect(conectados.size).toBe(CANTIDAD_NODOS)
  })

  /** El orden de aparición tiene que ser una permutación, no una lista con huecos. */
  it('da un orden de aparición sin repetir ni saltar', () => {
    const posiciones = [...malla.orden].sort((a, b) => a - b)
    expect(posiciones).toEqual([...Array(CANTIDAD_NODOS).keys()])
  })

  it('es determinista: dos construcciones dan exactamente lo mismo', () => {
    const otra = construirMalla()
    expect([...otra.posiciones]).toEqual([...malla.posiciones])
    expect(otra.aristas).toEqual(malla.aristas)
    expect([...otra.orden]).toEqual([...malla.orden])
  })

  it('cambia con la semilla', () => {
    const otra = construirMalla(CANTIDAD_NODOS, 1)
    expect([...otra.posiciones]).not.toEqual([...malla.posiciones])
  })
})

describe('construirEspina', () => {
  const espina = construirEspina()

  /** La invariante que sostiene el morfeo: un lugar por cada nodo de la nube. */
  it('tiene un lugar para cada nodo de la nube', () => {
    expect(espina.posiciones).toHaveLength(CANTIDAD_NODOS * 3)
    expect(espina.avance).toHaveLength(CANTIDAD_NODOS)
  })

  it('mete trece nodos al proceso y manda el resto detrás de la niebla', () => {
    expect(NODOS_ESPINA).toBe(13)
    expect([...espina.avance].filter((a) => a <= 1)).toHaveLength(NODOS_ESPINA)

    for (let i = NODOS_ESPINA; i < CANTIDAD_NODOS; i += 1) {
      expect(espina.avance[i], `nodo ${i}`).toBeGreaterThan(1)
      expect(espina.posiciones[i * 3 + 2], `nodo ${i}`).toBeLessThan(-4)
    }
  })

  it('reparte el avance entre 0 y 1, arrancando en el extremo izquierdo', () => {
    for (let i = 0; i < NODOS_ESPINA; i += 1) {
      expect(espina.avance[i], `nodo ${i}`).toBeGreaterThanOrEqual(0)
      expect(espina.avance[i], `nodo ${i}`).toBeLessThanOrEqual(1)
    }
    expect(Math.min(...[...espina.avance].filter((a) => a <= 1))).toBe(0)
  })

  /**
   * Toda arista avanza. Sin esto el frente verde pintaría una arista antes que
   * uno de sus extremos, y se verían líneas verdes colgando de nodos apagados.
   */
  it('todas las aristas van de menor a mayor avance', () => {
    for (const [a, b] of espina.aristas) {
      expect(espina.avance[b], `${a} -> ${b}`).toBeGreaterThan(espina.avance[a])
    }
  })

  it('solo conecta nodos de la espina y no deja a ninguno suelto', () => {
    const tocados = new Set(espina.aristas.flat())
    for (const [a, b] of espina.aristas) {
      expect(a).toBeLessThan(NODOS_ESPINA)
      expect(b).toBeLessThan(NODOS_ESPINA)
    }
    for (let i = 0; i < NODOS_ESPINA; i += 1) expect(tocados.has(i), `nodo ${i}`).toBe(true)
  })

  it('cabe en el encuadre', () => {
    for (let i = 0; i < NODOS_ESPINA; i += 1) {
      expect(Math.abs(espina.posiciones[i * 3])).toBeLessThanOrEqual(1.3)
      expect(Math.abs(espina.posiciones[i * 3 + 1])).toBeLessThanOrEqual(1.1)
    }
  })

  it('es determinista', () => {
    expect([...construirEspina().posiciones]).toEqual([...espina.posiciones])
  })
})

describe('anclaje de los iconos', () => {
  const espina = construirEspina()
  const x = (slot: number) => espina.posiciones[slot * 3]
  const y = (slot: number) => espina.posiciones[slot * 3 + 1]

  it('ancla cuatro iconos, todos a nodos de la espina', () => {
    expect(SLOTS_ICONO).toHaveLength(4)
    for (const slot of SLOTS_ICONO) expect(slot).toBeLessThan(NODOS_ESPINA)
  })

  /** Si no son equidistantes, la fila de iconos se ve puesta a ojo. */
  it('los apoya en nodos equidistantes del tronco', () => {
    const separaciones = SLOTS_ICONO.slice(1).map((slot, i) => x(slot) - x(SLOTS_ICONO[i]))
    for (const s of separaciones) expect(s).toBeCloseTo(separaciones[0], 5)
  })

  it('los apoya en el tronco, nunca en una rama', () => {
    for (const slot of SLOTS_ICONO) expect(y(slot)).toBe(0)
  })

  it('el primero y el último son los extremos del proceso', () => {
    const xs = [...Array(NODOS_ESPINA).keys()].map(x)
    expect(x(SLOTS_ICONO[0])).toBe(Math.min(...xs))
    expect(x(SLOTS_ICONO[SLOTS_ICONO.length - 1])).toBe(Math.max(...xs))
  })

  /** Proyectados, tienen que caer dentro del canvas con margen para el icono. */
  it('caen dentro del encuadre a la relación de aspecto del hero', () => {
    const aspecto = 437 / 416
    for (const slot of SLOTS_ICONO) {
      const { fx, fy } = proyectar(x(slot), y(slot), aspecto)
      expect(fx, `slot ${slot}`).toBeGreaterThan(0.03)
      expect(fx, `slot ${slot}`).toBeLessThan(0.97)
      expect(fy, `slot ${slot}`).toBeGreaterThan(0.1)
      expect(fy, `slot ${slot}`).toBeLessThan(0.9)
    }
  })
})
