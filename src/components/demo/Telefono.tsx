'use client'

import { useEffect, useRef, useState } from 'react'
import type { MensajeDemo } from '@/demo/estado'
import { horaDeReloj } from './hora'

/**
 * El teléfono del deudor.
 *
 * Rompe a propósito el lenguaje visual del resto del producto —papel, filetes,
 * cero esquinas redondeadas— porque esto no es nuestra interfaz: es WhatsApp. Un
 * chat con la estética de Ponox se leería como "una simulación nuestra"; con la
 * de WhatsApp se lee como lo que el deudor ve en su celular, que es todo el
 * punto de mostrarlo.
 */

const VERDE_CABECERA = '#075E54'
const VERDE_BURBUJA = '#D9FDD3'
const FONDO_CHAT = '#EFE7DE'

export interface TelefonoProps {
  titulo: string
  subtitulo: string
  mensajes: MensajeDemo[]
  escribiendo: boolean
  onEnviar: (texto: string) => void
  sugerencias: readonly string[]
  bloqueado: boolean
  /**
   * Modo limpio: sin los botones del guion, solo la barra de escritura.
   *
   * Es para grabar. Los botones son un andamio del presentador y en un video
   * delatan que hay alguien manejando la conversación desde afuera.
   */
  limpio?: boolean
}

export function Telefono({
  titulo,
  subtitulo,
  mensajes,
  escribiendo,
  onEnviar,
  sugerencias,
  bloqueado,
  limpio = false,
}: TelefonoProps) {
  const finRef = useRef<HTMLDivElement>(null)
  const [borrador, setBorrador] = useState('')

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes.length, escribiendo])

  function enviarBorrador() {
    const texto = borrador.trim()
    if (!texto || bloqueado) return
    setBorrador('')
    onEnviar(texto)
  }

  return (
    <div className="flex w-full max-w-[380px] flex-col overflow-hidden rounded-[2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-xl">
      <header
        className="flex items-center gap-3 px-4 pt-6 pb-3 text-white"
        style={{ background: VERDE_CABECERA }}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-medium">
          {iniciales(titulo)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] leading-tight font-medium">{titulo}</p>
          <p className="truncate text-[11px] leading-tight text-white/70">
            {escribiendo ? 'escribiendo…' : subtitulo}
          </p>
        </div>
      </header>

      <div
        className="flex h-[460px] flex-col gap-1.5 overflow-y-auto px-3 py-4"
        style={{ background: FONDO_CHAT }}
      >
        {mensajes.map((mensaje) => (
          <Burbuja key={mensaje.id} mensaje={mensaje} />
        ))}
        {escribiendo && (
          <div className="max-w-[80%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2.5">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="punto-escribiendo size-1.5 rounded-full bg-neutral-400"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {/* Barra de escritura. Un chat sin ella se ve como una captura, no como un teléfono. */}
      <div
        className="flex items-center gap-2 px-2.5 py-2.5"
        style={{ background: FONDO_CHAT, borderTop: '1px solid rgba(0,0,0,.06)' }}
      >
        <input
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enviarBorrador()
          }}
          placeholder="Mensaje"
          aria-label="Escribe un mensaje"
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <button
          type="button"
          onClick={enviarBorrador}
          aria-label="Enviar"
          className="grid size-10 shrink-0 place-items-center rounded-full text-white"
          style={{ background: VERDE_CABECERA }}
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
            <path d="M3.4 20.4 21 12 3.4 3.6l.02 6.53L15.5 12 3.42 13.87Z" fill="currentColor" />
          </svg>
        </button>
      </div>

      {!limpio && (
        <div className="border-t border-black/10 bg-white px-3 py-3">
          <p className="mb-2 text-[10px] tracking-[0.12em] text-neutral-400 uppercase">
            Responde como el deudor
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sugerencias.map((texto) => (
              <button
                key={texto}
                type="button"
                disabled={bloqueado}
                onClick={() => onEnviar(texto)}
                className="rounded-full border border-neutral-300 px-3 py-1.5 text-left text-[12px] leading-tight text-neutral-700 transition-colors hover:border-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Burbuja({ mensaje }: { mensaje: MensajeDemo }) {
  const delDeudor = mensaje.de === 'deudor'

  return (
    <div
      data-burbuja
      className={`animar-entrada max-w-[82%] px-3 py-2 text-[14px] leading-snug ${
        delDeudor
          ? 'self-end rounded-lg rounded-tr-none text-neutral-900'
          : 'self-start rounded-lg rounded-tl-none bg-white text-neutral-900'
      }`}
      style={delDeudor ? { background: VERDE_BURBUJA } : undefined}
    >
      {mensaje.de === 'humano' && (
        <p className="mb-0.5 text-[11px] font-medium text-emerald-800">
          {mensaje.autor ?? 'Equipo de cobranza'}
        </p>
      )}
      <p className="break-words whitespace-pre-wrap">{conEnlaces(mensaje.texto)}</p>
      <p className="mt-0.5 text-right text-[10px] text-neutral-500">{horaDeReloj(mensaje.ts)}</p>
    </div>
  )
}

/**
 * WhatsApp autoenlaza las URLs y ese detalle importa: el link de pago tiene que
 * verse tocable, no como texto pegado.
 */
function conEnlaces(texto: string) {
  const partes = texto.split(/(https?:\/\/\S+)/g)
  return partes.map((parte, i) =>
    /^https?:\/\//.test(parte) ? (
      <a
        key={i}
        href={parte}
        target="_blank"
        rel="noreferrer"
        className="text-sky-700 underline underline-offset-2"
      >
        {parte}
      </a>
    ) : (
      <span key={i}>{parte}</span>
    ),
  )
}

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
