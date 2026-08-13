import { cop } from '@/lib/formato'

/**
 * Piezas compartidas por las dos fases de la demo. `Burbuja` y `Escribiendo`
 * vienen casi literales del flujo anterior: la conversación no cambió, cambió
 * lo que la rodea.
 */

export function Burbuja({
  de,
  hora,
  children,
}: {
  de: 'agente' | 'cliente'
  hora: string
  children: React.ReactNode
}) {
  const esAgente = de === 'agente'
  return (
    <div className={`animar-entrada flex ${esAgente ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed',
          esAgente ? 'bg-ink text-paper' : 'border border-rule bg-paper text-ink',
        ].join(' ')}
      >
        {children}
        <span
          className={`mt-1.5 block text-[0.625rem] ${esAgente ? 'text-paper/55' : 'text-ink-faint'}`}
        >
          {hora}
        </span>
      </div>
    </div>
  )
}

export function Escribiendo() {
  return (
    <div className="animar-entrada flex justify-start">
      <div className="flex gap-1 border border-rule bg-paper px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="punto-escribiendo size-1.5 rounded-full bg-ink-faint"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export function TarjetaPago({ montoCop, referencia }: { montoCop: number; referencia: string }) {
  return (
    <div className="mt-2.5 border border-paper/25 p-2.5">
      <p className="text-[0.625rem] tracking-wide uppercase opacity-70">Pago seguro</p>
      <p data-cifra className="mt-1 text-lg">
        {cop(montoCop)}
      </p>
      <p className="mt-1 text-[0.6875rem] break-all opacity-70">Ref. {referencia}</p>
    </div>
  )
}

/**
 * El punto de estado del marco. Monocromo a propósito: un punto verde es el
 * cliché de SaaS que este lenguaje visual esquiva. Reusa el latido que ya
 * existe para los tres puntos de "escribiendo", así que no agrega CSS.
 */
export function PuntoEstado({ texto, vivo = true }: { texto: string; vivo?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full bg-ink ${vivo ? 'punto-escribiendo' : 'opacity-30'}`}
      />
      <span className="text-xs whitespace-nowrap text-ink-soft">{texto}</span>
    </span>
  )
}

/**
 * Texto que se está tecleando.
 *
 * El texto completo va debajo en `invisible` reservando la caja: sin eso, cada
 * punto de corte de línea desplaza el bloque entero cuando aparece un carácter,
 * y el bloque tiembla durante todo el tecleo.
 */
export function Tecleando({ completa, visible }: { completa: string; visible: string }) {
  return (
    <span className="grid">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {completa}
      </span>
      <span className="col-start-1 row-start-1">
        {visible}
        <span
          aria-hidden
          className="cursor-escritura ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] bg-ink"
        />
      </span>
    </span>
  )
}
