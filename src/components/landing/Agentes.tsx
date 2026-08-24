'use client'

import { useMemo, useState } from 'react'
import { DiagramaFlujo, claveArista } from './agentes/DiagramaFlujo'
import { FLUJOS, type Flujo, secuenciaDe } from './agentes/flujos'

/**
 * El catálogo, ahora recorrible.
 *
 * Cuatro agentes, cada uno con su diagrama. Nada se mueve solo: el visitante
 * avanza paso a paso o cliquea el nodo que le interesa. Un diagrama que se
 * anima solo se mira; uno que se recorre se entiende.
 */
export function Agentes() {
  const [idAgente, setIdAgente] = useState<Flujo['id']>('cobranza')
  const flujo = FLUJOS.find((f) => f.id === idAgente) ?? FLUJOS[0]
  const secuencia = useMemo(() => secuenciaDe(flujo), [flujo])

  const [activo, setActivo] = useState(() => secuencia[0].id)

  const indice = secuencia.findIndex((p) => p.id === activo)
  const enRamaAlterna = indice < 0
  const paso = flujo.pasos.find((p) => p.id === activo) ?? secuencia[0]

  const { nodos, aristas } = useMemo(() => recorridoHasta(flujo, activo), [flujo, activo])

  const elegirAgente = (id: Flujo['id']) => {
    const otro = FLUJOS.find((f) => f.id === id) ?? FLUJOS[0]
    setIdAgente(id)
    // Cambiar de agente reinicia: el paso 3 de uno no significa nada en el otro.
    setActivo(secuenciaDe(otro)[0].id)
  }

  return (
    <section id="agentes" className="scroll-mt-24">
      <p className="marca-seccion">§02 · Los agentes</p>
      <h2 className="mt-4 max-w-[20ch] text-title">
        El agente que tu operación <em className="font-serif italic">necesite</em>.
      </h2>
      <p className="medida mt-5 text-ink-soft">
        Cada uno arranca con algo que llega de afuera. Recórrelo paso a paso, o cliquea el paso que
        te interese.
      </p>

      <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
        <div className="flex flex-wrap">
          {FLUJOS.map((f, i) => {
            const activoAgente = f.id === idAgente
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={activoAgente}
                onClick={() => elegirAgente(f.id)}
                className={[
                  'border px-4 py-2 text-sm transition-colors',
                  i > 0 ? '-ml-px' : '',
                  activoAgente
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule-strong text-ink-soft hover:border-ink hover:text-ink',
                ].join(' ')}
              >
                {f.nombre}
              </button>
            )
          })}
        </div>

        <p className="text-sm text-ink-faint">
          {enRamaAlterna ? 'Rama alterna' : `Paso ${indice + 1} de ${secuencia.length}`}
        </p>
      </div>

      <p className="medida mt-5 text-sm text-ink-soft">{flujo.linea}</p>

      <div className="mt-8">
        <DiagramaFlujo
          flujo={flujo}
          activo={activo}
          recorridos={nodos}
          aristasRecorridas={aristas}
          alElegir={setActivo}
        />
      </div>

      {/* Lo que convierte el dibujo en explicación. `aria-live` para que el cambio se anuncie. */}
      <div className="mt-8 border-t border-ink pt-5">
        <p className="marca-seccion">{paso.titulo.join(' ')}</p>
        <p aria-live="polite" className="medida mt-2 text-lead">
          {paso.detalle}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setActivo(secuencia[Math.min(indice + 1, secuencia.length - 1)].id)}
          disabled={enRamaAlterna || indice >= secuencia.length - 1}
          className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-30"
        >
          Siguiente paso
        </button>
        <button
          type="button"
          onClick={() => setActivo(secuencia[0].id)}
          className="rounded-full border border-rule-strong px-5 py-2.5 text-sm transition-colors hover:border-ink"
        >
          Reiniciar
        </button>
        {enRamaAlterna ? (
          <p className="text-xs text-ink-faint">
            Esta es la salida cuando la decisión da no. Reinicia para seguir el camino principal.
          </p>
        ) : null}
      </div>

      <p className="medida mt-12 border-t border-rule pt-6 text-sm text-ink-soft">
        Implementación uno a uno. Cada agente sale con tus reglas, tus cuentas y tu marca; nada
        corre sobre infraestructura compartida con otro cliente.
      </p>
    </section>
  )
}

/**
 * Qué está recorrido cuando el paso activo es `activo`.
 *
 * Si el activo está en la secuencia principal, se recorre hasta ahí. Si es una
 * rama alterna, se recorre hasta la decisión que la origina y de ahí se salta a
 * ella: es el camino que de verdad se siguió para llegar a ese nodo.
 */
function recorridoHasta(flujo: Flujo, activo: string) {
  const secuencia = secuenciaDe(flujo)
  const indice = secuencia.findIndex((p) => p.id === activo)

  let ids: string[]
  if (indice >= 0) {
    ids = secuencia.slice(0, indice + 1).map((p) => p.id)
  } else {
    const entrante = flujo.aristas.find((a) => a.a === activo)
    const corte = entrante ? secuencia.findIndex((p) => p.id === entrante.de) : -1
    ids = [...secuencia.slice(0, corte + 1).map((p) => p.id), activo]
  }

  const aristas = new Set(ids.slice(1).map((id, i) => claveArista({ de: ids[i], a: id })))
  return { nodos: new Set(ids), aristas }
}
