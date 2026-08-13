import { describe, expect, it } from 'vitest'
import { CANTIDAD_NODOS, RADIO, construirMalla } from './malla'

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
