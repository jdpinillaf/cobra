import { copCorto } from '@/lib/formato'
import type { EstadoCaso, Tablero } from './guion'
import { Burbuja, Escribiendo, TarjetaPago } from './piezas'

/**
 * Acto 2: el agente atiende.
 *
 * A la izquierda la cola —que tiene largo fijo apenas se carga, así que los
 * casos cambian de estado en su sitio y nada hace reflow—; a la derecha el caso
 * abierto. En móvil se invierte: la conversación es la mitad que engancha, y el
 * progreso no se pierde porque los contadores viven en la barra de estado.
 */

const TONO: Record<EstadoCaso, string> = {
  en_cola: 'border-rule text-ink-faint',
  contactado: 'border-rule-strong text-ink-soft',
  negociando: 'border-ink text-ink',
  espera: 'border-diferido text-diferido',
  humano: 'border-diferido text-diferido',
  acuerdo: 'border-entregado text-entregado',
  pagado: 'border-entregado text-entregado',
}

const ETIQUETA: Record<EstadoCaso, string> = {
  en_cola: 'En cola',
  contactado: 'Contactado',
  negociando: 'Negociando',
  espera: 'En espera',
  humano: 'A una persona',
  acuerdo: 'Con acuerdo',
  pagado: 'Pagado',
}

export function FaseOperacion({
  tablero,
  estatico,
  refHilo,
}: {
  tablero: Tablero
  estatico: boolean
  refHilo: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className={`grid gap-y-8 lg:grid-cols-12 ${estatico ? '' : 'h-full min-h-0'}`}>
      <div
        className={`order-2 lg:order-none lg:col-span-5 lg:pr-8 ${
          estatico ? '' : 'min-h-0 overflow-y-auto'
        }`}
      >
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <p className="marca-seccion">Cola</p>
          <span className="text-xs text-ink-faint">lo que está atendiendo</span>
        </div>

        <ul className="mt-1">
          {tablero.casos.map((fila) => {
            const abierto = fila.caso.id === tablero.abierto
            return (
              <li
                key={fila.caso.id}
                className={`animar-entrada border-b border-rule py-2.5 ${
                  abierto ? '-ml-px border-l-2 border-l-ink pl-3' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-sm ${abierto ? 'text-ink' : 'text-ink-soft'}`}>
                      {fila.caso.nombre}
                    </p>
                    <p data-cifra className="text-xs text-ink-faint">
                      {fila.caso.id} · {copCorto(fila.caso.saldoCop)} · {fila.caso.diasMora} días
                    </p>
                  </div>
                  <span
                    className={`shrink-0 border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase ${TONO[fila.estado]}`}
                  >
                    {ETIQUETA[fila.estado]}
                  </span>
                </div>
                {fila.nota ? (
                  <p className="animar-entrada mt-1.5 text-xs text-ink-faint">{fila.nota}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>

      <div
        className={`order-1 flex flex-col lg:order-none lg:col-span-7 lg:border-l lg:border-rule lg:pl-8 ${
          estatico ? '' : 'min-h-0'
        }`}
      >
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <p className="marca-seccion">
            {tablero.abierto ? `Caso ${tablero.abierto}` : 'Caso'}
          </p>
          <span className="text-xs text-ink-faint">lo que ve la persona</span>
        </div>

        <div
          ref={refHilo}
          className={`mt-3 space-y-2.5 bg-paper-deep p-4 ${
            estatico ? '' : 'min-h-0 flex-1 overflow-y-auto'
          }`}
        >
          {/*
            Un panel vacío se lee como "esto no cargó". Con la línea puesta se
            lee como un sistema que todavía no abrió ningún caso, que es lo que
            está pasando.
          */}
          {tablero.conversacion.length === 0 ? (
            <p className="text-sm text-ink-faint">Todavía no ha abierto ningún caso.</p>
          ) : null}

          {tablero.conversacion.map((e, i) => {
            if (e.tipo === 'escribiendo') return <Escribiendo key={i} />

            if (e.tipo === 'link') {
              return (
                <Burbuja key={i} de="agente" hora={e.hora}>
                  <p>{e.texto}</p>
                  <TarjetaPago montoCop={e.montoCop} referencia={e.referencia} />
                </Burbuja>
              )
            }

            return (
              <Burbuja key={i} de={e.de} hora={e.hora}>
                {e.texto}
              </Burbuja>
            )
          })}
        </div>
      </div>
    </div>
  )
}
