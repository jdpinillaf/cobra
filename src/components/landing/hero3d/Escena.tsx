'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Group, Points } from 'three'
import { CANTIDAD_NODOS, construirMalla } from './malla'

/**
 * La red que se arma sola, en el hero.
 *
 * Los colores están escritos a mano porque los tokens del repo son `oklch` y
 * `THREE.Color` no parsea ese espacio. Cada hex se verificó contra el valor
 * que pinta el navegador — `--color-ink` da rgb(29,23,18) = #1d1712. Si cambia
 * la paleta en `globals.css`, estos tres se cambian con ella.
 */
const COLOR_NODO = '#1d1712' // --color-ink
const COLOR_ARISTA = '#b4b0ac' // --color-rule-strong
const COLOR_PAPEL = '#fcfbf8' // --color-paper

/** 6 s armando, 3 s armada, y vuelve a empezar. */
const SEGUNDOS_ARMADO = 6
const SEGUNDOS_CICLO = 9

export default function Escena({ corriendo, estatico }: { corriendo: boolean; estatico: boolean }) {
  return (
    <Canvas
      dpr={[1, 2]}
      /* `alpha` para que se vea el papel de la página detrás, no un fondo propio. */
      gl={{ antialias: true, alpha: true }}
      /* Sin mapeo de tonos: la escena es monocroma y no queremos que nadie la "mejore". */
      flat
      camera={{ position: [0, 0, 3.4], fov: 45 }}
      /*
       * Con movimiento reducido se pinta un cuadro y se acaba. El resto del
       * tiempo el bucle corre siempre y quien decide si hay trabajo es
       * `useFrame`: conmutar `frameloop` en caliente es una pieza móvil más
       * —y una fuente conocida de bucles que quedan detenidos— que para 28
       * puntos y 40 líneas no compra nada.
       */
      frameloop={estatico ? 'demand' : 'always'}
    >
      {/*
        Profundidad por niebla del color del papel: lo de atrás se desvanece
        contra la página en vez de oscurecerse. Es la única forma de dar
        volumen sin sombras ni degradados, que aquí están prohibidos.
      */}
      <fog attach="fog" args={[COLOR_PAPEL, 2.5, 5.2]} />
      <Red corriendo={corriendo} estatico={estatico} />
    </Canvas>
  )
}

function Red({ corriendo, estatico }: { corriendo: boolean; estatico: boolean }) {
  const grupo = useRef<Group>(null)
  const nodos = useRef<Points>(null)
  const aristas = useRef<import('three').LineSegments>(null)
  const reloj = useRef(0)

  /**
   * Las dos listas se construyen **en orden de aparición**. Así revelar la red
   * es mover un `setDrawRange`, no reescribir buffers en cada cuadro.
   */
  const { posNodos, posAristas, totalAristas } = useMemo(() => {
    const m = construirMalla()

    const nodoEnPosicion = new Array<number>(CANTIDAD_NODOS)
    for (let i = 0; i < CANTIDAD_NODOS; i += 1) nodoEnPosicion[m.orden[i]] = i

    const posNodos = new Float32Array(CANTIDAD_NODOS * 3)
    nodoEnPosicion.forEach((nodo, k) => {
      posNodos[k * 3] = m.posiciones[nodo * 3]
      posNodos[k * 3 + 1] = m.posiciones[nodo * 3 + 1]
      posNodos[k * 3 + 2] = m.posiciones[nodo * 3 + 2]
    })

    // Una arista aparece cuando ya está el último de sus dos extremos.
    const cuando = ([a, b]: readonly [number, number]) => Math.max(m.orden[a], m.orden[b])
    const ordenadas = [...m.aristas].sort((x, y) => cuando(x) - cuando(y))

    const posAristas = new Float32Array(ordenadas.length * 6)
    ordenadas.forEach(([a, b], k) => {
      for (let c = 0; c < 3; c += 1) {
        posAristas[k * 6 + c] = m.posiciones[a * 3 + c]
        posAristas[k * 6 + 3 + c] = m.posiciones[b * 3 + c]
      }
    })

    return { posNodos, posAristas, totalAristas: ordenadas.length }
  }, [])

  useFrame((_, delta) => {
    if (!grupo.current) return

    if (estatico) {
      nodos.current?.geometry.setDrawRange(0, CANTIDAD_NODOS)
      aristas.current?.geometry.setDrawRange(0, totalAristas * 2)
      return
    }

    // Fuera de pantalla el reloj no avanza: la red no se arma contra nadie.
    if (!corriendo) return

    reloj.current += delta

    // Mutación directa sobre los refs: un setState por cuadro tiraría la página.
    grupo.current.rotation.y += delta * 0.22
    grupo.current.rotation.x = Math.sin(reloj.current * 0.25) * 0.18

    const enCiclo = reloj.current % SEGUNDOS_CICLO
    const progreso = Math.min(1, enCiclo / SEGUNDOS_ARMADO)

    const nodosVisibles = Math.round(progreso * CANTIDAD_NODOS)
    nodos.current?.geometry.setDrawRange(0, nodosVisibles)

    /*
     * Las aristas van un paso por detrás de los nodos: se dibujan solo las que
     * ya tienen sus dos extremos en pantalla. Sin esto se ven líneas colgando
     * de la nada.
     */
    let aristasVisibles = 0
    while (aristasVisibles < totalAristas && aristasVisibles < progreso * totalAristas) {
      aristasVisibles += 1
    }
    aristas.current?.geometry.setDrawRange(0, aristasVisibles * 2)
  })

  return (
    <group ref={grupo}>
      <lineSegments ref={aristas}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[posAristas, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={COLOR_ARISTA} transparent opacity={0.85} />
      </lineSegments>

      <points ref={nodos}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[posNodos, 3]} />
        </bufferGeometry>
        {/* El punto por defecto de WebGL es un cuadrado, que es justo lo que quiere esta página. */}
        <pointsMaterial color={COLOR_NODO} size={0.05} sizeAttenuation />
      </points>
    </group>
  )
}
