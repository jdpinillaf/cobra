'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MARCA } from '@/lib/marca'
import type { VistaConversacion } from '@/demo/vista'
import { PanelExpediente } from './PanelExpediente'
import { Telefono } from './Telefono'

/**
 * La pantalla de la demo: teléfono a la izquierda, expediente a la derecha.
 *
 * El polling no es pereza de no montar SSE. Hay dos cosas que tienen que
 * aparecer **solas** en el teléfono, sin que nadie toque nada: la confirmación
 * del pago (que entra por otra pestaña) y la respuesta de una persona desde
 * Chatwoot (que entra por un webhook). Un segundo y medio es imperceptible en
 * vivo y no tiene ninguna de las formas de fallar de una conexión persistente
 * detrás del wifi de una sala de reuniones.
 */

const INTERVALO_MS = 1500

/**
 * Las frases del guion, en el orden en que se muestran.
 *
 * Están escritas para que el presentador no tenga que teclear —teclear en vivo
 * es donde se cometen los errores— y cubren las tres salidas que un cliente
 * siempre pregunta: la que termina en pago, la que se sale de los rangos, y las
 * dos que obligan al agente a callarse.
 */
const SUGERENCIAS = [
  'Buenas, ¿esto qué es?',
  'No tengo cómo pagar todo de una',
  '¿Y si me lo dejan en 8 cuotas?',
  'Listo, hagámosle en dos',
  'Mándeme el link',
  'Yo no soy Jorge, se equivocaron',
  'Ya pagué eso',
] as const

export function Consola({
  inicial,
  limpio = false,
}: {
  inicial: VistaConversacion
  /** Oculta los controles del presentador. Se activa con `/demo?limpio=1` para grabar. */
  limpio?: boolean
}) {
  const [vista, setVista] = useState(inicial)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const versionRef = useRef(inicial.version)

  const aplicar = useCallback((nueva: VistaConversacion) => {
    versionRef.current = nueva.version
    setVista(nueva)
  }, [])

  // Sondeo: trae lo que llegó por fuera de esta pantalla.
  useEffect(() => {
    let vivo = true
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/demo/conversacion?telefono=${encodeURIComponent(vista.telefono)}`, {
          cache: 'no-store',
        })
        if (!r.ok || !vivo) return
        const nueva = (await r.json()) as VistaConversacion
        if (nueva.version !== versionRef.current) aplicar(nueva)
      } catch {
        // Un sondeo perdido no es un error que valga la pena mostrar.
      }
    }, INTERVALO_MS)

    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [vista.telefono, aplicar])

  const enviar = useCallback(
    async (texto: string) => {
      setEnviando(true)
      setError(null)
      try {
        const r = await fetch('/api/demo/mensaje', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ telefono: vista.telefono, texto }),
        })
        if (!r.ok) {
          setError('El agente no respondió. Vuelve a intentar.')
          return
        }
        aplicar((await r.json()) as VistaConversacion)
      } catch {
        setError('Se cayó la conexión con el servidor.')
      } finally {
        setEnviando(false)
      }
    },
    [vista.telefono, aplicar],
  )

  const reiniciar = useCallback(async () => {
    const r = await fetch('/api/demo/conversacion', { method: 'DELETE' })
    if (r.ok) aplicar((await r.json()) as VistaConversacion)
  }, [aplicar])

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-rule-strong pb-4">
        <p className="marca-seccion">{MARCA.nombre}</p>
        <h1 className="text-[17px] font-medium">Agente de cobranza · {vista.expediente.nombre}</h1>
        <span className="rounded-full border border-diferido px-2.5 py-0.5 text-[11px] text-diferido">
          Ambiente de demostración · cartera de prueba
        </span>
        {!limpio && (
          <button
            type="button"
            onClick={reiniciar}
            className="ml-auto text-[12px] text-ink-soft underline underline-offset-4 hover:text-ink"
          >
            Reiniciar la conversación
          </button>
        )}
      </header>

      {error && (
        <p className="mb-4 border-l-2 border-bloqueado bg-paper-deep px-3 py-2 text-[13px] text-bloqueado">
          {error}
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-[380px_1fr] lg:gap-14">
        <div className="justify-self-center lg:sticky lg:top-8 lg:self-start">
          <Telefono
            titulo={vista.expediente.nombre}
            subtitulo={vista.telefono}
            mensajes={vista.mensajes}
            escribiendo={enviando}
            onEnviar={enviar}
            sugerencias={SUGERENCIAS}
            bloqueado={enviando}
            limpio={limpio}
          />
          <p className="mt-3 max-w-[380px] text-[11px] leading-snug text-ink-faint">
            Este es el celular del deudor. En producción es WhatsApp de verdad, contra el número de
            la empresa.
          </p>
        </div>

        <PanelExpediente vista={vista} />
      </div>
    </div>
  )
}
