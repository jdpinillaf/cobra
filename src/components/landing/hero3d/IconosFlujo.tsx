'use client'

import { useEffect, useRef, useState } from 'react'
import { SLOTS_ICONO, construirEspina, proyectar } from './malla'

/**
 * Los iconos que van apareciendo mientras el frente verde recorre la espina.
 *
 * Van **encima** del canvas, en SVG, no dentro de WebGL: un trazo de 1px se ve
 * nítido y una textura a este tamaño no, no hace falta shader, y se puede
 * verificar en un navegador sin GPU.
 *
 * **Cada icono se para sobre un nodo del tronco**, proyectando su posición 3D
 * con la misma cámara que usa la escena. Antes iban en porcentajes puestos a
 * ojo y caían donde caía: unas veces sobre un punto y otras sobre una línea.
 *
 * La capa es decorativa —el contenedor ya va `aria-hidden`— y no recibe clics.
 */

/** En orden de recorrido. Cada uno se ancla al slot de `SLOTS_ICONO` que le toca. */
const ICONOS = ['mensaje', 'usuario', 'cerebro', 'salida'] as const

/** Un icono cada 0,7 s: el recorrido dura 3,2 s y así el último entra con aire. */
const PASO_MS = 700

/**
 * Cuánto sube el icono respecto de su nodo.
 *
 * Es lo justo para no taparlo: los nodos de las ramas están a 88 px del tronco,
 * así que a 30 px el icono queda en tierra de nadie, sin pisar ni el punto ni
 * ninguna diagonal.
 */
const SOBRE_EL_NODO = 30

const ESPINA = construirEspina()

export function IconosFlujo({ estatico }: { estatico: boolean }) {
  const caja = useRef<HTMLDivElement>(null)
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 })

  useEffect(() => {
    const nodo = caja.current
    if (!nodo) return

    const observador = new ResizeObserver(([entrada]) => {
      const { width, height } = entrada.contentRect
      setMedida((antes) =>
        Math.round(antes.ancho) === Math.round(width) &&
        Math.round(antes.alto) === Math.round(height)
          ? antes
          : { ancho: width, alto: height },
      )
    })
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])

  const aspecto = medida.alto > 0 ? medida.ancho / medida.alto : 1

  return (
    <div ref={caja} className="pointer-events-none absolute inset-0">
      {medida.ancho === 0
        ? null
        : ICONOS.map((id, i) => {
            const slot = SLOTS_ICONO[i]
            const { fx, fy } = proyectar(
              ESPINA.posiciones[slot * 3],
              ESPINA.posiciones[slot * 3 + 1],
              aspecto,
            )

            return (
              <span
                key={id}
                className={[
                  'absolute text-ink',
                  estatico ? '-translate-x-1/2' : id === 'mensaje' ? 'icono-cae' : 'icono-surge',
                ].join(' ')}
                style={{
                  left: fx * medida.ancho,
                  top: fy * medida.alto - SOBRE_EL_NODO,
                  animationDelay: estatico ? undefined : `${i * PASO_MS}ms`,
                }}
              >
                <Icono id={id} />
              </span>
            )
          })}
    </div>
  )
}

/**
 * Trazo de 1,25 px, esquinas rectas y nada de relleno: los mismos filetes que
 * el resto de la página, a escala de icono.
 */
function Icono({ id }: { id: (typeof ICONOS)[number] }) {
  const comun = {
    width: 22,
    height: 22,
    viewBox: '0 0 22 22',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.25,
  }

  if (id === 'mensaje') {
    // Mensaje que llega: globo con la cola apuntando al nodo de abajo.
    return (
      <svg {...comun} aria-hidden>
        <path d="M2 3.5h18v11H8.5L4.5 19v-4.5H2z" />
        <path d="M6 7.5h10M6 10.5h6" />
      </svg>
    )
  }

  if (id === 'usuario') {
    // Quien escribe: cabeza y hombros.
    return (
      <svg {...comun} aria-hidden>
        <circle cx="11" cy="7" r="3.5" />
        <path d="M3.5 19c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
      </svg>
    )
  }

  if (id === 'cerebro') {
    /*
     * El agente pensando: dos lóbulos y el surco del medio.
     *
     * A 22 px un cerebro detallado se apelmaza y se lee como una mancha. Va con
     * el contorno ocupando casi toda la caja y solo tres trazos. Los pliegues
     * internos se probaron y sobraban.
     */
    return (
      <svg {...comun} aria-hidden>
        <path d="M11 3.2C8.8 1.6 5.2 2.4 4.4 5 2 5.7 1.2 8.9 3.2 10.6c-1.2 2.1.4 4.9 2.9 5.1.7 2.4 3.6 3.4 4.9 1.8" />
        <path d="M11 3.2c2.2-1.6 5.8-.8 6.6 1.8 2.4.7 3.2 3.9 1.2 5.6 1.2 2.1-.4 4.9-2.9 5.1-.7 2.4-3.6 3.4-4.9 1.8" />
        <path d="M11 3.2v14.3" />
      </svg>
    )
  }

  // El resultado que sale: de la caja hacia la derecha.
  return (
    <svg {...comun} aria-hidden>
      <path d="M12.5 3.5H3.5v15h9" />
      <path d="M9 11h10M15 7.5 18.5 11 15 14.5" />
    </svg>
  )
}
