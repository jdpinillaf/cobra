import { MARCA } from '@/lib/marca'

/**
 * El marco de las piezas que corren solas.
 *
 * Presentacional y sin estado, así que no lleva `'use client'`: lo puede
 * montar un componente servidor.
 *
 * Filete fuerte alrededor y en el encabezado —es parte del marco—, filete
 * liviano bajo la telemetría —es telemetría, no contenido—. Cero radios, cero
 * sombras: el lenguaje visual no cambia por meterle un marco.
 */
export function VentanaOperacion({
  modulo,
  estado,
  barraEstado,
  sangraEnMovil = true,
  children,
}: {
  /** Cambia con la fase. Es la mitad de lo que vende la transición. */
  modulo: string
  estado?: React.ReactNode
  barraEstado?: React.ReactNode
  sangraEnMovil?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={['border border-ink', sangraEnMovil ? '-mx-6 sm:mx-0' : ''].join(' ')}>
      <div className="flex items-center justify-between gap-4 border-b border-ink px-4 py-2.5 sm:px-5">
        <p className="marca-seccion flex items-baseline gap-2">
          <span>
            {MARCA.nombre.toLowerCase()} <span className="text-ink-faint">·</span>{' '}
            {/* La `key` re-dispara la animación de entrada cuando cambia de fase. */}
            <span key={modulo} className="animar-entrada inline-block text-ink-soft">
              {modulo}
            </span>
          </span>
          {/*
            Los contadores de abajo son reales respecto al guion, no respecto a
            tráfico de clientes. Decirlo cuesta nada y protege lo único que
            vendemos: que cada dato de la página se puede probar.
          */}
          <span className="border border-rule px-1 py-0.5 text-[0.625rem] tracking-wide text-ink-faint uppercase">
            guion
          </span>
        </p>
        {estado}
      </div>

      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>

      {barraEstado ? (
        <div aria-live="off" className="border-t border-rule px-4 py-2.5 sm:px-5">
          {barraEstado}
        </div>
      ) : null}
    </div>
  )
}
