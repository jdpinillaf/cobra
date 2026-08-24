'use client'

import { useState, useTransition } from 'react'
import { accionNuevaConversacion } from '@/app/consola/(app)/conversaciones/nueva/acciones'

/**
 * Alta de un caso a mano.
 *
 * Los campos son los mínimos para que el deudor sea contactable y el motor sepa
 * qué hacer con él. El tramo de mora no se pide: se deriva de los días, con la
 * misma función que usa el planificador. Pedirlo por formulario permite un
 * deudor con 200 días de mora en cadencia `preventiva`, que es la que dice "la
 * cuota todavía no vence".
 */

const CAMPO =
  'mt-1 w-full border border-rule-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink'
const ETIQUETA = 'text-marca uppercase tracking-[0.14em] text-ink-faint'

const DOCUMENTOS = ['CC', 'CE', 'NIT', 'TI', 'PA', 'PEP', 'OTRO'] as const

export function FormularioAlta() {
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [datos, setDatos] = useState({
    nombre: '',
    tipoDocumento: 'CC' as (typeof DOCUMENTOS)[number],
    documento: '',
    telefono: '+57',
    numeroCredito: '',
    saldoTotal: '',
    diasMora: '0',
  })

  const set = (campo: keyof typeof datos) => (valor: string) =>
    setDatos((d) => ({ ...d, [campo]: valor }))

  return (
    <div className="max-w-md">
      <h2 className="font-serif text-lead">Nueva conversación</h2>
      <p className="mt-2 text-sm text-ink-faint">
        Da de alta un deudor con su obligación y abre el hilo. Si ese documento ya existe, se
        actualizan sus datos en vez de duplicarlo.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-bloqueado">
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-4">
        <label className="block">
          <span className={ETIQUETA}>Nombre</span>
          <input
            value={datos.nombre}
            name="nombre"
            onChange={(e) => set('nombre')(e.target.value)}
            className={CAMPO}
            autoComplete="off"
          />
        </label>

        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <label className="block">
            <span className={ETIQUETA}>Tipo</span>
            <select
              value={datos.tipoDocumento}
              name="tipoDocumento"
              onChange={(e) =>
                setDatos((d) => ({
                  ...d,
                  tipoDocumento: e.target.value as (typeof DOCUMENTOS)[number],
                }))
              }
              className={CAMPO}
            >
              {DOCUMENTOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={ETIQUETA}>Documento</span>
            <input
              value={datos.documento}
              name="documento"
              onChange={(e) => set('documento')(e.target.value)}
              className={CAMPO}
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
        </div>

        <label className="block">
          <span className={ETIQUETA}>Teléfono</span>
          <input
            value={datos.telefono}
            name="telefono"
            onChange={(e) => set('telefono')(e.target.value)}
            className={CAMPO}
            placeholder="+573001112233"
            inputMode="tel"
            autoComplete="off"
          />
          <span className="mt-1 block text-[13px] text-ink-faint">
            Formato internacional. Es lo único que WhatsApp acepta.
          </span>
        </label>

        <label className="block">
          <span className={ETIQUETA}>Número de crédito</span>
          <input
            value={datos.numeroCredito}
            name="numeroCredito"
            onChange={(e) => set('numeroCredito')(e.target.value)}
            className={CAMPO}
            autoComplete="off"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ETIQUETA}>Saldo (COP)</span>
            <input
              value={datos.saldoTotal}
              name="saldoTotal"
              onChange={(e) => set('saldoTotal')(e.target.value.replace(/[^\d]/g, ''))}
              className={CAMPO}
              inputMode="numeric"
              data-cifra
            />
          </label>
          <label className="block">
            <span className={ETIQUETA}>Días de mora</span>
            <input
              value={datos.diasMora}
              name="diasMora"
              onChange={(e) => set('diasMora')(e.target.value.replace(/[^\d-]/g, ''))}
              className={CAMPO}
              inputMode="numeric"
              data-cifra
            />
          </label>
        </div>
      </div>

      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          setError(null)
          empezar(async () => {
            const r = await accionNuevaConversacion({
              nombre: datos.nombre,
              tipoDocumento: datos.tipoDocumento,
              documento: datos.documento,
              telefono: datos.telefono,
              numeroCredito: datos.numeroCredito,
              saldoTotal: Number(datos.saldoTotal),
              diasMora: Number(datos.diasMora),
            })
            // Si salió bien, la acción redirige y esto no llega a correr.
            if (r && !r.ok) setError(r.error ?? 'No se pudo crear.')
          })
        }}
        name="crear"
        className="mt-6 border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
      >
        {pendiente ? 'Creando…' : 'Crear y abrir el hilo'}
      </button>
    </div>
  )
}
