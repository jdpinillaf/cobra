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

// --- La segunda disposición: la espina ---

/**
 * Siete nodos de tronco, no seis: con siete hay cuatro posiciones pares
 * —0, 2, 4 y 6— **equidistantes**, y ahí van los cuatro iconos. Con seis, el
 * último par quedaba a media distancia del anterior.
 */
const TRONCO = 7
const RAMA = 3
/** Cuántos nodos entran al proceso. El resto se va. */
export const NODOS_ESPINA = TRONCO + RAMA * 2

/** Los nodos del tronco que llevan icono, de izquierda a derecha. */
export const SLOTS_ICONO = [0, 2, 4, 6] as const

/**
 * La cámara de la escena vive acá porque **la capa de iconos proyecta con estos
 * mismos números**. Si se separan, los iconos dejan de caer sobre los nodos.
 */
export const CAMARA = { z: 3.4, fov: 45 } as const

/** Medio alto visible en el plano z = 0, en unidades de mundo. */
const MEDIA_ALTURA = CAMARA.z * Math.tan(((CAMARA.fov / 2) * Math.PI) / 180)

/**
 * Proyecta un punto del plano z = 0 a fracciones 0..1 del canvas.
 *
 * Solo vale mientras la espina está de frente, que es exactamente cuando se
 * muestran los iconos: en el recorrido la rotación ya está en cero.
 */
export function proyectar(x: number, y: number, aspecto: number) {
  return {
    fx: 0.5 + x / (2 * MEDIA_ALTURA * aspecto),
    fy: 0.5 - y / (2 * MEDIA_ALTURA),
  }
}

/**
 * Los que no entran a la espina se mandan **detrás del plano lejano de la
 * niebla**: se desvanecen contra el papel sin necesitar opacidad por vértice,
 * que exigiría un shader propio.
 */
const Z_FUERA = -6

export interface Espina {
  /** xyz **por slot de aparición** de la nube, no por id de nodo. */
  readonly posiciones: Float32Array
  readonly aristas: readonly (readonly [number, number])[]
  /**
   * Posición del nodo en el recorrido, de 0 a 1 según su x. Los que quedaron
   * fuera traen 2: nunca los alcanza el frente verde.
   */
  readonly avance: Float32Array
}

/**
 * Una espina de izquierda a derecha con dos ramas cortas que salen y vuelven.
 *
 * Se indexa por **slot de aparición**, así que los doce primeros —los que en la
 * nube nacen más cerca del centro— son los que forman el proceso. Eso conserva
 * la invariante que sostiene el morfeo: los mismos nodos en las dos figuras, el
 * índice es la identidad.
 */
export function construirEspina(cantidad = CANTIDAD_NODOS): Espina {
  const posiciones = new Float32Array(cantidad * 3)
  const avance = new Float32Array(cantidad).fill(2)

  const poner = (slot: number, x: number, y: number, z = 0) => {
    posiciones[slot * 3] = x
    posiciones[slot * 3 + 1] = y
    posiciones[slot * 3 + 2] = z
  }

  const xTronco = (i: number) => -1.25 + i * (2.5 / (TRONCO - 1))

  // Tronco: slots 0..6, de izquierda a derecha y a paso constante.
  for (let i = 0; i < TRONCO; i += 1) poner(i, xTronco(i), 0)

  /*
   * Las dos ramas se abren en el tronco 1 y se cierran en el 5, y sus nodos van
   * **en la misma x que los del tronco 2, 3 y 4**. Así la figura queda simétrica
   * y alineada en columnas en vez de parecer acomodada a ojo.
   */
  const xRama = [xTronco(2), xTronco(3), xTronco(4)]
  xRama.forEach((x, i) => poner(TRONCO + i, x, 0.6))
  xRama.forEach((x, i) => poner(TRONCO + RAMA + i, x, -0.6))

  /*
   * Los de afuera se reparten en un anillo detrás de la niebla. Nunca se ven,
   * pero repartirlos evita que se apilen en un punto durante el morfeo y se
   * lean como un borrón mientras se van.
   */
  for (let i = NODOS_ESPINA; i < cantidad; i += 1) {
    const a = (i / Math.max(1, cantidad - NODOS_ESPINA)) * Math.PI * 2
    poner(i, Math.cos(a) * 2.4, Math.sin(a) * 2.4, Z_FUERA)
  }

  // El avance es la x normalizada: el frente verde barre de izquierda a derecha.
  for (let i = 0; i < NODOS_ESPINA; i += 1) avance[i] = (posiciones[i * 3] + 1.25) / 2.5

  const alta = [1, TRONCO, TRONCO + 1, TRONCO + 2, 5]
  const baja = [1, TRONCO + RAMA, TRONCO + RAMA + 1, TRONCO + RAMA + 2, 5]

  const aristas: [number, number][] = []
  for (let i = 0; i < TRONCO - 1; i += 1) aristas.push([i, i + 1])
  for (const cadena of [alta, baja]) {
    for (let i = 0; i < cadena.length - 1; i += 1) aristas.push([cadena[i], cadena[i + 1]])
  }

  return { posiciones, aristas, avance }
}
