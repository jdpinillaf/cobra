'use client'

import { useEffect, useRef, useState } from 'react'
import { MS_POR_CARACTER } from './guion'

/**
 * Revela un texto carácter por carácter.
 *
 * Se descartaron dos caminos:
 *
 * - **CSS `steps()` sobre `width`.** Exige `white-space: nowrap` y la unidad
 *   `ch`. Instrument Sans es proporcional, así que los caracteres no miden
 *   `1ch` y el reveal queda desalineado; y una línea de 55 caracteres no cabe
 *   en la columna sin envolver.
 * - **`setInterval` por carácter.** Dos timers que miden la misma duración pero
 *   cuentan distinto: en cuanto uno se atrasa (pestaña de fondo, cuadro largo,
 *   GC) el timer global avanza y la línea se corta a media palabra.
 *
 * (El nombre arranca con `use` y no con `usar`, contra la convención en español
 * del resto del repo, porque `react-hooks/rules-of-hooks` reconoce los hooks
 * por el prefijo del nombre.)
 *
 * Este acumula el delta real de cada cuadro sobre un `ref`. Al pausar, el bucle
 * simplemente deja de correr y el acumulado queda intacto: reanuda en el
 * carácter exacto, sin rebobinar. Y si un cuadro tarda 200 ms, salta al
 * carácter correcto en vez de arrastrar el retraso.
 */
export function useEscritura(texto: string | null, activo: boolean): string {
  /*
   * El avance guarda a qué texto pertenece. Así el reinicio al cambiar de línea
   * se **deriva** en el render en vez de necesitar un efecto que llame a
   * `setState`, que provocaría un render en cascada por cada línea del guion.
   */
  const [avance, setAvance] = useState({ texto: '', n: 0 })
  const acumulado = useRef(0)

  const visibles = avance.texto === texto ? avance.n : 0

  useEffect(() => {
    if (!texto || !activo) return

    acumulado.current = visibles
    let cuadro = 0
    let anterior = performance.now()

    const avanzar = (ahora: number) => {
      acumulado.current += (ahora - anterior) / MS_POR_CARACTER
      anterior = ahora

      const n = Math.min(texto.length, Math.floor(acumulado.current))
      setAvance({ texto, n })
      if (n < texto.length) cuadro = requestAnimationFrame(avanzar)
    }

    cuadro = requestAnimationFrame(avanzar)
    return () => cancelAnimationFrame(cuadro)
    // `visibles` solo siembra el acumulado al (re)arrancar; incluirlo reiniciaría
    // el bucle en cada cuadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, activo])

  return texto ? texto.slice(0, visibles) : ''
}
