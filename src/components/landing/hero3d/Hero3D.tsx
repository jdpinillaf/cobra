'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Acto } from './Escena'
import { IconosFlujo } from './IconosFlujo'

/**
 * Las tres puertas que hay que pasar antes de bajar three.js.
 *
 * 1. **Ancho.** Por debajo de `lg` el componente no se monta, así que el chunk
 *    de WebGL **nunca se descarga en un teléfono**. Un `hidden lg:block` no
 *    sirve: renderiza igual y el navegador se trae los ~150 KB para esconderlos.
 * 2. **`ssr: false`.** Vive dentro de este componente cliente a propósito: en
 *    Next 16 no se puede pedir desde un componente servidor, y `page.tsx` lo es.
 * 3. **Fuera de pantalla.** El canvas deja de pintar cuando el visitante bajó.
 *
 * La pieza es decorativa: va `aria-hidden` y no lleva texto que alguien pueda
 * necesitar.
 */
const Escena = dynamic(() => import('./Escena'), { ssr: false })

const ANCHO_MINIMO = '(min-width: 1024px)'

/**
 * Sin contexto WebGL, `WebGLRenderer` tira y llena la consola de errores por
 * una pieza que es pura decoración. Pasa de verdad: navegadores con la
 * aceleración apagada, máquinas virtuales, y cualquier navegador headless.
 * Preguntar cuesta un canvas que se descarta.
 */
function soportaWebGL(): boolean {
  try {
    const prueba = document.createElement('canvas')
    return Boolean(prueba.getContext('webgl2') ?? prueba.getContext('webgl'))
  } catch {
    return false
  }
}

export function Hero3D() {
  const [montar, setMontar] = useState(false)
  const [visible, setVisible] = useState(true)
  const [estatico, setEstatico] = useState(false)
  const ancla = useRef<HTMLDivElement>(null)

  /**
   * El acto que corre ahora, y qué vuelta del bucle va.
   *
   * La escena lo avisa seis veces por ciclo. `vuelta` sube cada vez que empieza
   * una nube nueva, y se usa como `key` de la capa de iconos: remontarla es lo
   * que hace que sus animaciones vuelvan a correr en cada vuelta.
   */
  const [acto, setActo] = useState<Acto | null>(null)
  const [vuelta, setVuelta] = useState(0)

  const alCambiarActo = useCallback((nuevo: Acto) => {
    setActo(nuevo)
    if (nuevo === 'nube') setVuelta((v) => v + 1)
  }, [])

  // Los iconos entran con el recorrido y se quedan hasta que arranca otra vuelta.
  const conIconos = estatico || acto === 'recorrido' || acto === 'reposo'

  useEffect(() => {
    const ancho = window.matchMedia(ANCHO_MINIMO)
    const movimiento = window.matchMedia('(prefers-reduced-motion: reduce)')

    const hayWebGL = soportaWebGL()
    const aplicar = () => {
      setMontar(ancho.matches && hayWebGL)
      setEstatico(movimiento.matches)
    }

    aplicar()
    ancho.addEventListener('change', aplicar)
    movimiento.addEventListener('change', aplicar)
    return () => {
      ancho.removeEventListener('change', aplicar)
      movimiento.removeEventListener('change', aplicar)
    }
  }, [])

  useEffect(() => {
    const nodo = ancla.current
    if (!nodo) return

    const observador = new IntersectionObserver(
      (entradas) => setVisible(entradas[0]?.isIntersecting ?? false),
      { threshold: 0.1 },
    )
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])

  return (
    <div
      ref={ancla}
      aria-hidden
      /* El alto se reserva siempre: el hero no puede saltar cuando entra el chunk. */
      className="relative h-[26rem] w-full"
    >
      {montar ? (
        <Escena corriendo={visible} estatico={estatico} alCambiarActo={alCambiarActo} />
      ) : null}
      {montar && conIconos ? <IconosFlujo key={vuelta} estatico={estatico} /> : null}
    </div>
  )
}
