'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Color, type Group, type LineSegments, type Points } from 'three'
import { CAMARA, CANTIDAD_NODOS, construirEspina, construirMalla } from './malla'

/**
 * La pieza del hero: cinco actos en bucle de 11 s.
 *
 * 1. **Nube** — los nodos aparecen del centro hacia afuera y se conectan.
 * 2. **Giro** — la nube acelera.
 * 3. **Colapso** — todo se junta en un nudo.
 * 4. **Flujo** — se separa; trece nodos se acomodan en una espina de izquierda a
 *    derecha y el resto se va detrás de la niebla.
 * 5. **Recorrido** — el flujo se ejecuta: un frente verde lo barre hasta el final.
 *
 * Los mismos 28 nodos hacen las dos figuras. El índice es la identidad, así que
 * pasar de una a la otra es interpolar posiciones — no hay nodos que nazcan ni
 * mueran, que es lo que haría que se leyera como dos animaciones pegadas.
 *
 * Los colores están escritos a mano porque los tokens del repo son `oklch` y
 * `THREE.Color` no parsea ese espacio. Cada hex se verificó contra el valor que
 * pinta el navegador — `--color-ink` da rgb(29,23,18) = #1d1712. Si cambia la
 * paleta en `globals.css`, estos cuatro se cambian con ella.
 */
const COLOR_NODO = '#1d1712' // --color-ink
const COLOR_ARISTA = '#b4b0ac' // --color-rule-strong
const COLOR_PAPEL = '#fcfbf8' // --color-paper
const COLOR_HECHO = '#2e6c47' // --color-entregado

/**
 * Duración de cada acto, en segundos. Cambiar aquí cambia el ritmo entero.
 *
 * El armado va corto a propósito: es lo primero que ve el visitante y esperar a
 * que aparezcan 28 nodos de a uno se siente como carga, no como animación.
 */
const ACTOS = {
  nube: 1.8,
  giro: 1.5,
  colapso: 1.1,
  flujo: 1.4,
  recorrido: 3.2,
  reposo: 1.6,
} as const

export type Acto = keyof typeof ACTOS

const ORDEN_ACTOS = Object.keys(ACTOS) as Acto[]
const CICLO = ORDEN_ACTOS.reduce((s, a) => s + ACTOS[a], 0)

/** Cuánto del radio conserva la nube en el punto más apretado del colapso. */
const NUDO = 0.06

const VELOCIDAD_BASE = 0.26
const VELOCIDAD_PICO = 3.4

/** En qué acto estamos y cuánto llevamos de él, entre 0 y 1. */
function actoEn(t: number): { acto: Acto; p: number } {
  let desde = 0
  for (const acto of ORDEN_ACTOS) {
    const hasta = desde + ACTOS[acto]
    if (t < hasta) return { acto, p: (t - desde) / ACTOS[acto] }
    desde = hasta
  }
  return { acto: 'reposo', p: 1 }
}

const suave = (x: number) => x * x * (3 - 2 * x)

/**
 * Las dos figuras y sus tablas de índices se calculan **una vez por módulo**:
 * son deterministas y no dependen de nada del componente.
 *
 * Todo se guarda en **orden de aparición**, no por id de nodo, así revelar la
 * nube es mover un `drawRange` en vez de reescribir buffers.
 */
const FIGURAS = (() => {
  const nube = construirMalla()
  const espina = construirEspina()

  const nodoDeSlot = new Array<number>(CANTIDAD_NODOS)
  for (let i = 0; i < CANTIDAD_NODOS; i += 1) nodoDeSlot[nube.orden[i]] = i
  const slotDeNodo = new Int32Array(CANTIDAD_NODOS)
  nodoDeSlot.forEach((nodo, slot) => {
    slotDeNodo[nodo] = slot
  })

  /*
   * `posNube` se reordena por slot; la espina **ya viene** en ese espacio,
   * porque se autoró así: sus trece primeros lugares son los nodos que en la
   * nube nacen más cerca del centro.
   */
  const posNube = new Float32Array(CANTIDAD_NODOS * 3)
  nodoDeSlot.forEach((nodo, slot) => {
    for (let c = 0; c < 3; c += 1) posNube[slot * 3 + c] = nube.posiciones[nodo * 3 + c]
  })

  // Una arista de la nube aparece cuando ya está el último de sus dos extremos.
  const paresNube = nube.aristas
    .map(([a, b]) => [slotDeNodo[a], slotDeNodo[b]] as [number, number])
    .sort((x, y) => Math.max(...x) - Math.max(...y))

  // Una arista se pinta cuando el frente pasó su extremo más adelantado.
  const avanceArista = Float32Array.from(
    espina.aristas.map(([a, b]) => Math.max(espina.avance[a], espina.avance[b])),
  )

  return {
    posNube,
    posFlujo: espina.posiciones,
    avance: espina.avance,
    paresNube,
    paresFlujo: espina.aristas,
    avanceArista,
    base: new Color(COLOR_NODO),
    baseArista: new Color(COLOR_ARISTA),
    hecho: new Color(COLOR_HECHO),
  }
})()

/** Los buffers iniciales de los atributos. Uno por instancia montada. */
function crearBuffers() {
  return {
    posNodos: Float32Array.from(FIGURAS.posNube),
    colorNodos: new Float32Array(CANTIDAD_NODOS * 3),
    posLineasNube: new Float32Array(FIGURAS.paresNube.length * 6),
    posLineasFlujo: new Float32Array(FIGURAS.paresFlujo.length * 6),
    colorLineasFlujo: new Float32Array(FIGURAS.paresFlujo.length * 6),
  }
}

/** Pinta el vértice `i` de un buffer de color. */
function pintar(buffer: Float32Array, i: number, color: Color) {
  buffer[i * 3] = color.r
  buffer[i * 3 + 1] = color.g
  buffer[i * 3 + 2] = color.b
}

/** Copia las posiciones de los nodos a los dos vértices de cada arista. */
function tejer(
  destino: Float32Array,
  pares: readonly (readonly [number, number])[],
  nodos: Float32Array,
) {
  pares.forEach(([a, b], k) => {
    for (let c = 0; c < 3; c += 1) {
      destino[k * 6 + c] = nodos[a * 3 + c]
      destino[k * 6 + 3 + c] = nodos[b * 3 + c]
    }
  })
}

export default function Escena({
  corriendo,
  estatico,
  alCambiarActo,
}: {
  corriendo: boolean
  estatico: boolean
  /**
   * Avisa cuando cambia de acto — seis veces por ciclo, no una por cuadro.
   *
   * Es lo que deja que la capa de iconos, que vive fuera del canvas, siga la
   * coreografía sin que un `setState` por cuadro tire la página.
   */
  alCambiarActo?: (acto: Acto) => void
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      /* `alpha` para que se vea el papel de la página detrás, no un fondo propio. */
      gl={{ antialias: true, alpha: true }}
      /* Sin mapeo de tonos: la escena es monocroma y no queremos que nadie la "mejore". */
      flat
      /* Los números viven en `malla.ts`: la capa de iconos proyecta con los mismos. */
      camera={{ position: [0, 0, CAMARA.z], fov: CAMARA.fov }}
      /*
       * Con movimiento reducido se pinta un cuadro y se acaba. El resto del
       * tiempo el bucle corre siempre y quien decide si hay trabajo es
       * `useFrame`: conmutar `frameloop` en caliente es una pieza móvil más
       * —y una fuente conocida de bucles que quedan detenidos— que para 28
       * puntos y un puñado de líneas no compra nada.
       */
      frameloop={estatico ? 'demand' : 'always'}
    >
      {/*
        Profundidad por niebla del color del papel: lo de atrás se desvanece
        contra la página en vez de oscurecerse. Es la única forma de dar
        volumen sin sombras ni degradados, que aquí están prohibidos.
      */}
      <fog attach="fog" args={[COLOR_PAPEL, 2.5, 5.2]} />
      <Coreografia corriendo={corriendo} estatico={estatico} alCambiarActo={alCambiarActo} />
    </Canvas>
  )
}

function Coreografia({
  corriendo,
  estatico,
  alCambiarActo,
}: {
  corriendo: boolean
  estatico: boolean
  alCambiarActo?: (acto: Acto) => void
}) {
  const grupo = useRef<Group>(null)
  const nodos = useRef<Points>(null)
  const lineasNube = useRef<LineSegments>(null)
  const lineasFlujo = useRef<LineSegments>(null)

  const reloj = useRef(0)
  /** Rotación al entrar al flujo: desde ahí se frena hasta quedar de frente. */
  const rotacionAlFrenar = useRef({ x: 0, y: 0 })
  const frenando = useRef(false)
  const actoAnterior = useRef<Acto | null>(null)

  /*
   * Los buffers iniciales viven en estado con inicialización perezosa: se crean
   * una vez y React los lee en el render para armar los atributos.
   *
   * **Cada cuadro no los toca a ellos, sino al array del atributo de la
   * geometría** —el mismo dato, ya en manos de three—. Es el patrón idiomático
   * de three y deja fuera de React todo lo que se muta, que es lo que el
   * compilador exige.
   */
  const [inicial] = useState(crearBuffers)

  useFrame((_, delta) => {
    if (!grupo.current || !nodos.current) return
    // Fuera de pantalla el reloj no avanza: la coreografía no corre contra nadie.
    if (!corriendo && !estatico) return

    const attrNodos = nodos.current.geometry.attributes.position
    const attrColorNodos = nodos.current.geometry.attributes.color
    if (!attrNodos || !attrColorNodos) return

    const attrLineasNube = lineasNube.current?.geometry.attributes.position
    const attrLineasFlujo = lineasFlujo.current?.geometry.attributes.position
    const attrColorFlujo = lineasFlujo.current?.geometry.attributes.color

    const posNodos = attrNodos.array as Float32Array
    const colorNodos = attrColorNodos.array as Float32Array

    /*
     * Con movimiento reducido se congela el final del recorrido: el flujo
     * completo y ya ejecutado. Es el cuadro que más cuenta de qué se trata.
     */
    const t = estatico ? CICLO - ACTOS.reposo / 2 : (reloj.current += delta) % CICLO
    const { acto, p } = actoEn(t)

    if (acto !== actoAnterior.current) {
      actoAnterior.current = acto
      alCambiarActo?.(acto)
    }

    // --- Posiciones: nube → nudo → espina ---
    const escalaNube =
      acto === 'colapso' ? 1 - (1 - NUDO) * suave(p) : acto === 'nube' || acto === 'giro' ? 1 : NUDO
    const mezcla = acto === 'flujo' ? suave(p) : acto === 'recorrido' || acto === 'reposo' ? 1 : 0

    for (let i = 0; i < CANTIDAD_NODOS * 3; i += 1) {
      posNodos[i] = FIGURAS.posNube[i] * escalaNube * (1 - mezcla) + FIGURAS.posFlujo[i] * mezcla
    }
    attrNodos.needsUpdate = true

    if (attrLineasNube) {
      tejer(attrLineasNube.array as Float32Array, FIGURAS.paresNube, posNodos)
      attrLineasNube.needsUpdate = true
    }
    if (attrLineasFlujo) {
      tejer(attrLineasFlujo.array as Float32Array, FIGURAS.paresFlujo, posNodos)
      attrLineasFlujo.needsUpdate = true
    }

    // --- Revelado de la nube ---
    const revelado = acto === 'nube' ? p : 1
    nodos.current.geometry.setDrawRange(0, Math.round(revelado * CANTIDAD_NODOS))
    lineasNube.current?.geometry.setDrawRange(0, Math.ceil(revelado * FIGURAS.paresNube.length) * 2)

    // --- Opacidad: la malla de la nube cede su lugar a la de la espina ---
    const salida = acto === 'flujo' ? 1 - suave(p) : mezcla === 1 ? 0 : 1
    setOpacidad(lineasNube.current, 0.85 * salida)
    setOpacidad(lineasFlujo.current, 0.9 * (1 - salida))

    // --- Rotación: base, acelerón, y frenada hasta quedar de frente ---
    if (acto === 'flujo' || acto === 'recorrido' || acto === 'reposo') {
      if (!frenando.current) {
        frenando.current = true
        // Se normaliza a (-π, π] para frenar por el camino corto.
        let y = grupo.current.rotation.y % (Math.PI * 2)
        if (y > Math.PI) y -= Math.PI * 2
        if (y < -Math.PI) y += Math.PI * 2
        rotacionAlFrenar.current = { x: grupo.current.rotation.x, y }
      }
      const queda = acto === 'flujo' ? 1 - suave(p) : 0
      grupo.current.rotation.y = rotacionAlFrenar.current.y * queda
      grupo.current.rotation.x = rotacionAlFrenar.current.x * queda
    } else {
      frenando.current = false
      const velocidad =
        acto === 'giro'
          ? VELOCIDAD_BASE + (VELOCIDAD_PICO - VELOCIDAD_BASE) * suave(p)
          : acto === 'colapso'
            ? VELOCIDAD_PICO
            : VELOCIDAD_BASE
      grupo.current.rotation.y += delta * velocidad
      grupo.current.rotation.x = Math.sin(t * 0.3) * 0.18
    }

    // --- El frente verde recorriendo la espina, de izquierda a derecha ---
    const frente = acto === 'recorrido' ? p : acto === 'reposo' ? 1 : -1

    for (let i = 0; i < CANTIDAD_NODOS; i += 1) {
      const hecho = frente >= 0 && FIGURAS.avance[i] <= frente
      pintar(colorNodos, i, hecho ? FIGURAS.hecho : FIGURAS.base)
    }
    attrColorNodos.needsUpdate = true

    if (attrColorFlujo) {
      const colores = attrColorFlujo.array as Float32Array
      FIGURAS.paresFlujo.forEach((_par, k) => {
        const hecha = frente >= 0 && FIGURAS.avanceArista[k] <= frente
        pintar(colores, k * 2, hecha ? FIGURAS.hecho : FIGURAS.baseArista)
        pintar(colores, k * 2 + 1, hecha ? FIGURAS.hecho : FIGURAS.baseArista)
      })
      attrColorFlujo.needsUpdate = true
    }
  })

  return (
    <group ref={grupo}>
      {/* La malla de la nube: vecinos más cercanos, un solo color. */}
      <lineSegments ref={lineasNube}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[inicial.posLineasNube, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={COLOR_ARISTA} transparent opacity={0.85} />
      </lineSegments>

      {/* La de la espina: color por vértice, porque el recorrido las pinta de a una. */}
      <lineSegments ref={lineasFlujo}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[inicial.posLineasFlujo, 3]} />
          <bufferAttribute attach="attributes-color" args={[inicial.colorLineasFlujo, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0} />
      </lineSegments>

      <points ref={nodos}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[inicial.posNodos, 3]} />
          <bufferAttribute attach="attributes-color" args={[inicial.colorNodos, 3]} />
        </bufferGeometry>
        {/* El punto por defecto de WebGL es un cuadrado, que es justo lo que quiere esta página. */}
        <pointsMaterial vertexColors size={0.05} sizeAttenuation />
      </points>
    </group>
  )
}

function setOpacidad(objeto: LineSegments | null, valor: number) {
  const material = objeto?.material
  if (material && !Array.isArray(material) && 'opacity' in material) {
    material.opacity = valor
  }
}
