'use client'

import { useState, useTransition } from 'react'
import {
  accionEnviar,
  accionNota,
  accionCerrar,
  accionPausar,
  accionReanudar,
  accionSimularEntrante,
  accionTomar,
} from '@/app/consola/(app)/conversaciones/[id]/acciones'

/**
 * Controles del hilo y redactor.
 *
 * El redactor cambia de forma según la ventana de 24 h de WhatsApp: abierta,
 * muestra cuánto queda y deja escribir libre; cerrada, bloquea el texto y ofrece
 * las plantillas aprobadas.
 *
 * Ese bloqueo es comodidad, no seguridad. La regla real la aplica el servidor en
 * `decidirEnvioManual`; acá está para que la persona **vea** la regla en vez de
 * chocarse con un error después de escribir tres párrafos.
 */

export interface PlantillaUI {
  id: string
  nombre: string
  cuerpo: string
  categoria: string
  variables: string[]
}

function faltaPara(expiraEn: string): string {
  const ms = new Date(expiraEn).getTime() - Date.now()
  if (ms <= 0) return 'cerrada'
  const horas = Math.floor(ms / 3_600_000)
  const minutos = Math.floor((ms % 3_600_000) / 60_000)
  return horas > 0 ? `${horas} h ${minutos} min` : `${minutos} min`
}

const BOTON = 'border border-rule-strong px-3 py-1.5 hover:bg-paper-deep disabled:opacity-50'
const PRIMARIO = 'border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50'

export function Controles({
  conversacionId,
  agentePausado,
  asignadaA,
  usuarioId,
  ventanaExpiraEn,
  plantillas,
  modoDemo,
}: {
  conversacionId: string
  agentePausado: boolean
  asignadaA: string | null
  usuarioId: string
  ventanaExpiraEn: string | null
  plantillas: PlantillaUI[]
  /**
   * Habilita el redactor que escribe **como el deudor**. Solo lo tienen los
   * clientes marcados `modo_demo`, que es `false` por defecto.
   *
   * Esconderlo es comodidad, no seguridad: la regla la aplica `simularEntrante`
   * en el servidor. Acá está para que nadie vea un botón que le va a decir que no.
   */
  modoDemo: boolean
}) {
  const [pendiente, empezar] = useTransition()
  /**
   * Cuál de los botones está corriendo.
   *
   * `useTransition` da un solo `pendiente` para todos, así que al simular un
   * entrante el botón de enviar decía "Enviando…" — o sea, afirmaba que le
   * estaba saliendo un mensaje al deudor cuando no salía ninguno. En una
   * pantalla que gasta plata del cliente, eso no es un detalle de estilo.
   */
  const [enCurso, setEnCurso] = useState<'enviar' | 'recibir' | 'cerrar' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [nota, setNota] = useState('')
  const [comoDeudor, setComoDeudor] = useState('')
  const [plantillaId, setPlantillaId] = useState('')
  const [variables, setVariables] = useState<string[]>([])

  const abierta = ventanaExpiraEn !== null && new Date(ventanaExpiraEn).getTime() > Date.now()
  const elegida = plantillas.find((p) => p.id === plantillaId) ?? null

  const correr = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    cual: 'enviar' | 'recibir' | 'cerrar' | null = null,
  ) => {
    setError(null)
    setEnCurso(cual)
    empezar(async () => {
      // `finally`, no la última línea del bloque. Si la acción lanza —una caída
      // de red basta— `setEnCurso(null)` no corría y los botones quedaban
      // trabados hasta recargar. `pendiente` se recupera solo; esto no.
      try {
        const r = await fn()
        if (!r.ok) setError(r.error ?? 'No se pudo.')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo.')
      } finally {
        setEnCurso(null)
      }
    })
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            correr(() =>
              agentePausado
                ? accionReanudar(conversacionId)
                : accionPausar(conversacionId, 'Lo manejo yo'),
            )
          }
          className={BOTON}
        >
          {agentePausado ? 'Reanudar el agente' : 'Pausar el agente'}
        </button>

        {asignadaA !== usuarioId && (
          <button
            type="button"
            disabled={pendiente}
            onClick={() => correr(() => accionTomar(conversacionId))}
            className={BOTON}
          >
            {asignadaA ? 'Tomar el hilo' : 'Asignármelo'}
          </button>
        )}

        <button
          type="button"
          disabled={pendiente}
          onClick={() => correr(() => accionCerrar(conversacionId), 'cerrar')}
          className={BOTON}
        >
          {enCurso === 'cerrar' ? 'Cerrando…' : 'Cerrar el hilo'}
        </button>

        <span className={`ml-auto text-[13px] ${abierta ? 'text-entregado' : 'text-diferido'}`}>
          {abierta && ventanaExpiraEn
            ? `Ventana abierta · quedan ${faltaPara(ventanaExpiraEn)}`
            : 'Ventana cerrada · solo plantillas'}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-bloqueado">
          {error}
        </p>
      )}

      {abierta ? (
        <div className="mt-3">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Escribí tu respuesta…"
            aria-label="Mensaje para el deudor"
            className="w-full resize-y border border-rule-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pendiente || texto.trim() === ''}
              onClick={() =>
                correr(async () => {
                  const r = await accionEnviar(conversacionId, { texto })
                  if (r.ok) setTexto('')
                  return r
                }, 'enviar')
              }
              className={PRIMARIO}
            >
              {enCurso === 'enviar' ? 'Enviando…' : 'Enviar'}
            </button>
            <span className="text-[13px] text-ink-faint">Responder a mano pausa el agente.</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 border border-rule bg-paper-deep p-3">
          <p className="text-sm text-ink-soft">
            Pasaron más de 24 horas desde el último mensaje del deudor. WhatsApp solo acepta
            plantillas aprobadas hasta que vuelva a escribir.
          </p>

          {plantillas.length === 0 ? (
            <p className="mt-2 text-sm text-ink-faint">
              Todavía no hay plantillas aprobadas por Meta para este cliente.
            </p>
          ) : (
            <>
              <select
                value={plantillaId}
                onChange={(e) => {
                  setPlantillaId(e.target.value)
                  const p = plantillas.find((x) => x.id === e.target.value)
                  setVariables(new Array(p?.variables.length ?? 0).fill(''))
                }}
                aria-label="Plantilla"
                className="mt-2 w-full border border-rule-strong bg-paper px-2 py-1.5 text-sm"
              >
                <option value="">Elegí una plantilla…</option>
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} · {p.categoria}
                  </option>
                ))}
              </select>

              {elegida && (
                <>
                  <p className="mt-2 whitespace-pre-wrap border-l-2 border-rule pl-2 text-sm text-ink-soft">
                    {elegida.cuerpo}
                  </p>
                  {elegida.variables.map((v, i) => (
                    <label key={v} className="mt-2 block">
                      <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">
                        {v}
                      </span>
                      <input
                        value={variables[i] ?? ''}
                        onChange={(e) => {
                          const copia = [...variables]
                          copia[i] = e.target.value
                          setVariables(copia)
                        }}
                        className="mt-1 w-full border-b border-rule-strong bg-transparent py-1 text-sm outline-none focus:border-ink"
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={pendiente || variables.some((v) => v.trim() === '')}
                    onClick={() =>
                      correr(async () => {
                        const r = await accionEnviar(conversacionId, { plantillaId, variables })
                        if (r.ok) {
                          setPlantillaId('')
                          setVariables([])
                        }
                        return r
                      }, 'enviar')
                    }
                    className={`mt-3 ${PRIMARIO}`}
                  >
                    {enCurso === 'enviar' ? 'Enviando…' : 'Enviar plantilla'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {modoDemo && (
        <div className="mt-5 border-t border-dashed border-rule pt-4">
          <p className="text-marca uppercase tracking-[0.14em] text-ink-faint">Modo demo</p>
          <p className="mt-1 text-[13px] text-ink-faint">
            Escribe como si escribiera el deudor. Entra por el mismo webhook que usa Meta —abre la
            ventana de 24 h, detecta la baja— y queda marcado como simulado en el historial.
          </p>
          <textarea
            value={comoDeudor}
            onChange={(e) => setComoDeudor(e.target.value)}
            rows={2}
            placeholder="Lo que diría el deudor…"
            aria-label="Mensaje como el deudor"
            className="mt-2 w-full resize-y border border-dashed border-rule-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <button
            type="button"
            name="recibir"
            disabled={pendiente || comoDeudor.trim() === ''}
            onClick={() =>
              correr(async () => {
                const r = await accionSimularEntrante(conversacionId, comoDeudor)
                if (r.ok) setComoDeudor('')
                return r
              }, 'recibir')
            }
            className={`mt-2 text-sm ${BOTON}`}
          >
            {enCurso === 'recibir' ? 'Recibiendo…' : 'Recibir como deudor'}
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-rule pt-4">
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota interna — el deudor no la ve…"
          aria-label="Nota interna"
          className="w-full resize-y border border-rule bg-[#FFF8E1] px-3 py-2 text-sm outline-none focus:border-diferido"
        />
        <button
          type="button"
          disabled={pendiente || nota.trim() === ''}
          onClick={() =>
            correr(async () => {
              const r = await accionNota(conversacionId, nota)
              if (r.ok) setNota('')
              return r
            })
          }
          className={`mt-2 text-sm ${BOTON}`}
        >
          Guardar nota
        </button>
      </div>
    </div>
  )
}
