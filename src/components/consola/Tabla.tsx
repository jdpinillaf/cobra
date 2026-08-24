/**
 * La tabla de la consola.
 *
 * Es la primera tabla de datos del repo: hasta ahora todo era landing y una
 * demo de un solo deudor. Sin librería de UI, sobre los tokens que ya existen
 * en globals.css, porque el sistema de diseño de la landing es el mismo
 * producto y una consola que parezca otra cosa se lee como otro proveedor.
 *
 * `tabular-nums` en las celdas de plata no es estética: sin eso las columnas de
 * pesos no alinean y comparar dos saldos de un vistazo se vuelve imposible.
 */
export function Tabla({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  )
}

export function Encabezado({ columnas }: { columnas: Array<{ clave: string; label: string; num?: boolean }> }) {
  return (
    <thead>
      <tr className="border-b border-rule-strong">
        {columnas.map((c) => (
          <th
            key={c.clave}
            scope="col"
            className={`px-3 py-2 text-marca font-medium uppercase tracking-[0.14em] text-ink-faint ${
              c.num ? 'text-right' : 'text-left'
            }`}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function Celda({
  children,
  num = false,
  suave = false,
}: {
  children: React.ReactNode
  num?: boolean
  suave?: boolean
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${num ? 'text-right tabular-nums' : ''} ${
        suave ? 'text-ink-soft' : 'text-ink'
      }`}
    >
      {children}
    </td>
  )
}

const TONO = {
  entregado: 'text-entregado',
  diferido: 'text-diferido',
  bloqueado: 'text-bloqueado',
  neutro: 'text-ink-soft',
} as const

/** Punto de color + texto. Los tres tonos ya son los del sistema. */
export function Estado({
  tono,
  children,
}: {
  tono: keyof typeof TONO
  children: React.ReactNode
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${TONO[tono]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
