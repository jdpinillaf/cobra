/**
 * La geometría de la pieza del hero: una red de nodos que se arma sola.
 *
 * Pura y determinista, sin three y sin React. Dos motivos:
 *
 * 1. Es lo único de la escena que se puede testear — no hay entorno de DOM ni
 *    de WebGL en los tests del repo, pero unas coordenadas sí se verifican.
 * 2. La figura tiene que verse **igual en cada carga**. Con `Math.random` la
 *    red saldría distinta cada vez y no habría forma de juzgar un cambio
 *    mirando dos capturas.
 */

export const CANTIDAD_NODOS = 28
export const RADIO = 1
/** Cuántos vecinos toma cada nodo. Con 2 la red se lee; con 3 se vuelve lana. */
const VECINOS = 2
const SEMILLA = 20260813

/** El mismo PRNG que usa el generador de cartera. Barato y reproducible. */
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Malla {
  /** xyz de cada nodo, plano: [x0,y0,z0, x1,y1,z1, …]. Listo para un BufferAttribute. */
  readonly posiciones: Float32Array
  /** Pares de índices de nodo. Sin repetidos y sin reflexivas. */
  readonly aristas: readonly (readonly [number, number])[]
  /**
   * Orden en que entran los nodos: del centro hacia afuera.
   *
   * `orden[i]` es la posición de aparición del nodo `i` (0 = el primero). Con
   * esto la red crece desde adentro en vez de parpadear entera.
   */
  readonly orden: Int32Array
}

/**
 * Espiral de Fibonacci sobre la esfera: reparte los puntos parejo sin que se
 * apelmacen en los polos, que es lo que pasa con lat/lon a mano. El jitter
 * rompe la regularidad justo lo suficiente para que no se lea como una malla
 * de manual.
 */
export function construirMalla(cantidad = CANTIDAD_NODOS, semilla = SEMILLA): Malla {
  const azar = mulberry32(semilla)
  const dorado = Math.PI * (3 - Math.sqrt(5))

  const puntos: [number, number, number][] = []
  for (let i = 0; i < cantidad; i += 1) {
    const y = 1 - (i / Math.max(1, cantidad - 1)) * 2
    const radioAnillo = Math.sqrt(Math.max(0, 1 - y * y))
    const angulo = dorado * i

    // Jitter de ±6 % del radio. Más que eso y los vecinos más cercanos cambian.
    const j = () => (azar() - 0.5) * 0.12
    puntos.push([
      (Math.cos(angulo) * radioAnillo + j()) * RADIO,
      (y + j()) * RADIO,
      (Math.sin(angulo) * radioAnillo + j()) * RADIO,
    ])
  }

  const posiciones = new Float32Array(cantidad * 3)
  puntos.forEach(([x, y, z], i) => {
    posiciones[i * 3] = x
    posiciones[i * 3 + 1] = y
    posiciones[i * 3 + 2] = z
  })

  /*
   * Aristas por vecino más cercano. La clave `menor-mayor` es lo que evita que
   * A→B y B→A entren las dos: la mitad de los pares son recíprocos y sin esto
   * se dibujarían dos veces, una encima de la otra.
   */
  const vistas = new Set<string>()
  const aristas: [number, number][] = []

  for (let i = 0; i < cantidad; i += 1) {
    const cercanos = puntos
      .map((p, j) => ({ j, d: distancia(puntos[i], p) }))
      .filter((c) => c.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, VECINOS)

    for (const { j } of cercanos) {
      const clave = i < j ? `${i}-${j}` : `${j}-${i}`
      if (vistas.has(clave)) continue
      vistas.add(clave)
      aristas.push(i < j ? [i, j] : [j, i])
    }
  }

  // Del centro hacia afuera: los nodos más cercanos al origen aparecen primero.
  const porDistancia = puntos
    .map((p, i) => ({ i, d: Math.hypot(p[0], p[1], p[2]) }))
    .sort((a, b) => a.d - b.d)

  const orden = new Int32Array(cantidad)
  porDistancia.forEach(({ i }, posicion) => {
    orden[i] = posicion
  })

  return { posiciones, aristas, orden }
}

function distancia(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
