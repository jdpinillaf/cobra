'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { MARCA } from '@/lib/marca'

/**
 * Entrar.
 *
 * Un solo mensaje de error, el que devuelve el servidor. Distinguir "ese correo
 * no existe" de "clave incorrecta" le confirma a quien prueba qué cuentas hay.
 */
export default function PaginaEntrar() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)

    const r = await fetch('/api/consola/sesion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, clave }),
    })

    if (r.ok) {
      router.push('/consola/cartera')
      router.refresh()
      return
    }

    const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null
    setError(cuerpo?.error ?? 'No se pudo entrar.')
    setEnviando(false)
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-5 text-ink">
      <form onSubmit={entrar} className="w-full max-w-sm">
        <p className="font-serif text-title">{MARCA.nombre}</p>
        <p className="mt-1 text-sm text-ink-soft">Consola de seguimiento</p>

        <label className="mt-8 block">
          <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">Correo</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full border-b border-rule-strong bg-transparent py-2 outline-none focus:border-ink"
          />
        </label>

        <label className="mt-5 block">
          <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">Contraseña</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="mt-1.5 w-full border-b border-rule-strong bg-transparent py-2 outline-none focus:border-ink"
          />
        </label>

        {error && (
          <p role="alert" className="mt-5 text-sm text-bloqueado">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="mt-8 w-full border border-ink bg-ink px-4 py-2.5 text-paper disabled:opacity-50"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
