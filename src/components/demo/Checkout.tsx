'use client'

import { useState } from 'react'

/**
 * Pasarela simulada.
 *
 * No es Wompi: es una página nuestra que se comporta como una. La decisión fue
 * deliberada — el sandbox de Wompi es más creíble pero depende de que responda
 * en el momento de la reunión, y una demo que se cuelga en el paso del pago no
 * se recupera. Lo que sí es real es lo de después: la referencia
 * `COB-{obligación}-{nonce}` sale de `src/payments/wompi.ts` y la conciliación
 * la resuelve el mismo código que resolvería un webhook de Wompi.
 *
 * Cuando se conecte la pasarela de verdad, esta página desaparece y el link del
 * agente apunta a `checkout.wompi.co`. Nada más cambia.
 */

const MEDIOS = [
  { id: 'pse', nombre: 'PSE', detalle: 'Débito desde tu banco' },
  { id: 'nequi', nombre: 'Nequi', detalle: 'Pago con tu celular' },
  { id: 'tarjeta', nombre: 'Tarjeta', detalle: 'Crédito o débito' },
] as const

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

export interface CobroProps {
  referencia: string
  monto: number
  comercio: string
  deudor: string | null
  numeroCredito: string | null
  saldoTotal: number | null
  yaPagado: boolean
}

export function Checkout(props: CobroProps) {
  const [medio, setMedio] = useState<string>('pse')
  const [estado, setEstado] = useState<'listo' | 'procesando' | 'aprobado' | 'error'>(
    props.yaPagado ? 'aprobado' : 'listo',
  )

  async function pagar() {
    setEstado('procesando')
    try {
      const r = await fetch('/api/demo/pago', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ referencia: props.referencia }),
      })
      setEstado(r.ok ? 'aprobado' : 'error')
    } catch {
      setEstado('error')
    }
  }

  if (estado === 'aprobado') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-entregado/10">
          <svg viewBox="0 0 24 24" className="size-7 text-entregado" aria-hidden>
            <path
              d="M4 12.5l5 5L20 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mb-2 text-title font-serif">Pago aprobado</h1>
        <p className="mb-6 text-[15px] text-ink-soft">
          Pagaste {cop(props.monto)} a {sinPuntoFinal(props.comercio)}.
        </p>
        <p className="border-t border-rule pt-5 text-[13px] text-ink-soft">
          Ya puedes volver a WhatsApp. La confirmación te llega ahí en un momento.
        </p>
        <p className="mt-5 text-[11px] text-ink-faint" data-cifra>
          Referencia {props.referencia}
        </p>
      </div>
    )
  }

  return (
    <>
      <header className="mb-6 border-b border-rule-strong pb-4">
        <p className="marca-seccion mb-1">Pago seguro</p>
        <h1 className="text-[19px] font-medium">{props.comercio}</h1>
      </header>

      <section className="mb-6">
        <p className="mb-1 text-[13px] text-ink-soft">Vas a pagar</p>
        <p className="mb-5 text-title font-serif" data-cifra>
          {cop(props.monto)}
        </p>

        <dl className="text-[13px]">
          <Fila etiqueta="Concepto" valor={`Crédito ${props.numeroCredito ?? '—'}`} />
          {props.deudor && <Fila etiqueta="A nombre de" valor={props.deudor} />}
          {props.saldoTotal !== null && (
            <Fila etiqueta="Saldo del crédito" valor={cop(props.saldoTotal)} />
          )}
          <Fila etiqueta="Referencia" valor={props.referencia} />
        </dl>
        <p className="mt-3 text-[11px] leading-snug text-ink-faint">
          La referencia es lo que amarra este pago a tu crédito. Por eso se acredita solo, sin que
          nadie tenga que cruzarlo a mano.
        </p>
      </section>

      <section className="mb-7">
        <p className="mb-3 text-[13px] text-ink-soft">¿Cómo quieres pagar?</p>
        <div className="flex flex-col">
          {MEDIOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMedio(m.id)}
              aria-pressed={medio === m.id}
              className={`flex items-center gap-3 border-b border-rule px-1 py-3 text-left transition-colors ${
                medio === m.id ? 'bg-paper-deep' : 'hover:bg-paper-deep/60'
              }`}
            >
              <span
                className={`size-3.5 shrink-0 rounded-full border ${
                  medio === m.id ? 'border-[5px] border-ink' : 'border-rule-strong'
                }`}
              />
              <span>
                <span className="block text-[14px] font-medium">{m.nombre}</span>
                <span className="block text-[12px] text-ink-faint">{m.detalle}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {estado === 'error' && (
        <p className="mb-4 border-l-2 border-bloqueado px-3 py-2 text-[13px] text-bloqueado">
          No se pudo procesar. Vuelve a intentar.
        </p>
      )}

      <button
        type="button"
        onClick={pagar}
        disabled={estado === 'procesando'}
        className="w-full rounded-full bg-ink px-6 py-3.5 text-[15px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {estado === 'procesando' ? 'Procesando…' : `Pagar ${cop(props.monto)}`}
      </button>

      <p className="mt-4 text-center text-[11px] text-ink-faint">
        El dinero va directo a la cuenta de {sinPuntoFinal(props.comercio)}.
      </p>
    </>
  )
}

/** Muchas razones sociales terminan en punto («S.A.S.») y sumarle otro se ve descuidado. */
function sinPuntoFinal(nombre: string): string {
  return nombre.replace(/\.$/, '')
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="text-ink-soft">{etiqueta}</dt>
      <dd className="text-right" data-cifra>
        {valor}
      </dd>
    </div>
  )
}
