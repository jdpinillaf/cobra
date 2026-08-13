import { HERRAMIENTAS, type Tablero } from './guion'
import { Tecleando } from './piezas'

/**
 * Acto 1: se configura el agente.
 *
 * Vista tonta. Todo lo que muestra sale de `reducir()`; lo único que recibe
 * aparte es la línea que se está tecleando en este instante, que todavía no
 * entró al tablero.
 */
export function FaseConfiguracion({
  tablero,
  escribiendo,
  estatico,
}: {
  tablero: Tablero
  escribiendo: { completa: string; visible: string } | null
  estatico: boolean
}) {
  return (
    <div className={`grid gap-y-8 lg:grid-cols-12 ${estatico ? '' : 'h-full min-h-0'}`}>
      <div className={`lg:col-span-7 lg:pr-8 ${estatico ? '' : 'min-h-0 overflow-y-auto'}`}>
        <p className="marca-seccion border-b border-rule pb-2">Instrucción</p>

        <div className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink-soft sm:text-[0.9375rem]">
          {tablero.instruccion.map((linea, i) => (
            <p key={i} className="text-ink">
              {linea}
            </p>
          ))}
          {escribiendo ? (
            <p className="text-ink">
              <Tecleando completa={escribiendo.completa} visible={escribiendo.visible} />
            </p>
          ) : null}
        </div>

        {tablero.desplegando ? (
          <p className="animar-entrada mt-6 border-t border-ink pt-3 text-sm">
            Agente desplegado. Empieza a atender.
          </p>
        ) : null}
      </div>

      <div
        className={`lg:col-span-5 lg:border-l lg:border-rule lg:pl-8 ${estatico ? '' : 'min-h-0 overflow-y-auto'}`}
      >
        <p className="marca-seccion border-b border-rule pb-2">Plan</p>
        <ol className="mt-1">
          {tablero.cadencia.map((paso) => (
            <li
              key={paso.orden}
              className="animar-entrada flex items-baseline gap-3 border-b border-rule py-2 text-sm"
            >
              <span data-cifra className="shrink-0 text-xs text-ink-faint">
                {paso.cuando}
              </span>
              <span className="text-ink-soft">{paso.texto}</span>
            </li>
          ))}
        </ol>

        <p className="marca-seccion mt-6 border-b border-rule pb-2">Herramientas</p>
        <ul className="mt-1">
          {/*
            Se pre-renderizan todas: al conectarse cambian de peso de filete, no
            aparecen. El bloque no crece y se lee como un formulario llenándose.
          */}
          {HERRAMIENTAS.map((h) => {
            const conectada = tablero.herramientas.some((c) => c.id === h.id)
            return (
              <li
                key={h.id}
                className={`flex items-baseline gap-2.5 border-b py-2 ${
                  conectada ? 'border-ink' : 'border-rule'
                }`}
              >
                {/*
                  Un filete que se dibuja, no un spinner ni una palomita verde:
                  el check es exactamente lo que hace que se lea como maqueta.
                */}
                <span
                  aria-hidden
                  className={`mt-2 h-px w-4 shrink-0 ${
                    conectada ? 'animar-conexion bg-ink' : 'bg-rule'
                  }`}
                />
                <div className="min-w-0">
                  <p className={`text-sm ${conectada ? 'text-ink' : 'text-ink-faint'}`}>
                    {h.nombre}
                  </p>
                  {conectada ? (
                    <p className="animar-entrada truncate text-xs text-ink-faint">{h.detalle}</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
