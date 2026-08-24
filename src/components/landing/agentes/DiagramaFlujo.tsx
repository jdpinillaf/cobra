import type { Arista, Flujo, Paso } from './flujos'

/**
 * El diagrama, en SVG.
 *
 * Presentacional: recibe el flujo y qué está recorrido, y no decide nada. En
 * SVG y no en WebGL porque aquí el texto tiene que leerse nítido, los nodos
 * tienen que responder al clic y al teclado, y los filetes de 1px son el
 * lenguaje de la página.
 */

/** Aristas y nodos se identifican igual para no cruzar dos convenciones. */
export const claveArista = (a: Arista) => `${a.de}→${a.a}`

const TIPO_LETRA = 15
const TIPO_ETIQUETA = 11

export function DiagramaFlujo({
  flujo,
  activo,
  recorridos,
  aristasRecorridas,
  alElegir,
}: {
  flujo: Flujo
  activo: string
  /** Ids de pasos ya recorridos, incluido el activo. */
  recorridos: ReadonlySet<string>
  aristasRecorridas: ReadonlySet<string>
  alElegir: (id: string) => void
}) {
  const por = (id: string) => flujo.pasos.find((p) => p.id === id)

  return (
    /*
      Un diagrama de flujo es ancho por naturaleza. En vez de encogerlo hasta
      que el texto no se lea, se deja desbordar y se sangra a los bordes en
      móvil: el mismo recurso que ya usaba la tabla de precios.
    */
    <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
      <svg
        viewBox={`0 0 ${flujo.ancho} ${flujo.alto}`}
        className="h-auto w-full"
        style={{ minWidth: 900 }}
        role="img"
        aria-label={`Flujo del agente de ${flujo.nombre.toLowerCase()}`}
      >
        <defs>
          {/* Dos puntas: una del color del filete y otra del recorrido. */}
          {(
            [
              ['flecha', 'fill-rule-strong'],
              ['flecha-hecha', 'fill-entregado'],
            ] as const
          ).map(([id, clase]) => (
            <marker
              key={id}
              id={`${flujo.id}-${id}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 7 4 L 0 7 z" className={clase} />
            </marker>
          ))}
        </defs>

        {flujo.aristas.map((a) => {
          const desde = por(a.de)
          const hasta = por(a.a)
          if (!desde || !hasta) return null

          const hecha = aristasRecorridas.has(claveArista(a))
          const { d, etiquetaEn } = ruta(desde, hasta)

          return (
            <g key={claveArista(a)}>
              <path
                d={d}
                fill="none"
                strokeWidth={1}
                className={hecha ? 'stroke-entregado' : 'stroke-rule-strong'}
                markerEnd={`url(#${flujo.id}-${hecha ? 'flecha-hecha' : 'flecha'})`}
              />
              {a.etiqueta ? (
                <text
                  x={etiquetaEn.x}
                  y={etiquetaEn.y}
                  fontSize={TIPO_ETIQUETA}
                  textAnchor="middle"
                  className={hecha ? 'fill-entregado' : 'fill-ink-faint'}
                >
                  {a.etiqueta}
                </text>
              ) : null}
            </g>
          )
        })}

        {flujo.pasos.map((paso) => (
          <Caja
            key={paso.id}
            paso={paso}
            esActivo={paso.id === activo}
            hecho={recorridos.has(paso.id)}
            alElegir={alElegir}
          />
        ))}
      </svg>
    </div>
  )
}

function Caja({
  paso,
  esActivo,
  hecho,
  alElegir,
}: {
  paso: Paso
  esActivo: boolean
  hecho: boolean
  alElegir: (id: string) => void
}) {
  const borde = esActivo ? 'stroke-ink' : hecho ? 'stroke-entregado' : 'stroke-rule'
  const relleno = esActivo ? 'fill-paper-deep' : 'fill-paper'
  const letra = esActivo ? 'fill-ink' : hecho ? 'fill-entregado' : 'fill-ink-soft'

  const centro = paso.x + paso.ancho / 2
  // Con dos líneas, la primera sube media línea para que el par quede centrado.
  const base = paso.y + paso.alto / 2 + (paso.titulo.length === 1 ? 5 : -2)

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Paso: ${paso.titulo.join(' ')}`}
      aria-current={esActivo ? 'step' : undefined}
      onClick={() => alElegir(paso.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        alElegir(paso.id)
      }}
      className="cursor-pointer"
    >
      {paso.etiqueta ? (
        <text
          x={paso.x}
          y={paso.y - 8}
          fontSize={TIPO_ETIQUETA}
          className="fill-ink-faint tracking-[0.14em] uppercase"
        >
          {paso.etiqueta}
        </text>
      ) : null}

      <rect
        x={paso.x}
        y={paso.y}
        width={paso.ancho}
        height={paso.alto}
        strokeWidth={esActivo ? 2 : 1}
        className={`${borde} ${relleno} transition-colors`}
      />

      {paso.titulo.map((linea, i) => (
        <text
          key={i}
          x={centro}
          y={base + i * 18}
          fontSize={TIPO_LETRA}
          textAnchor="middle"
          /* Las decisiones van en serif itálica: es la marca de énfasis de la página. */
          className={`${letra} ${paso.tipo === 'decision' ? 'font-serif italic' : ''}`}
        >
          {linea}
        </text>
      ))}
    </g>
  )
}

/**
 * Ruta ortogonal de caja a caja: sale por la derecha, entra por la izquierda, y
 * si hay que cambiar de fila lo hace con un codo en el punto medio. Rectas y
 * ángulos rectos, nunca curvas: es el mismo trazo que los filetes de la página.
 */
function ruta(desde: Paso, hasta: Paso) {
  const x1 = desde.x + desde.ancho
  const y1 = desde.y + desde.alto / 2
  const x2 = hasta.x
  const y2 = hasta.y + hasta.alto / 2
  const xm = (x1 + x2) / 2

  if (Math.abs(y1 - y2) < 1) {
    return { d: `M ${x1} ${y1} H ${x2}`, etiquetaEn: { x: xm, y: y1 - 8 } }
  }

  return {
    d: `M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`,
    etiquetaEn: { x: xm + 12, y: (y1 + y2) / 2 },
  }
}
