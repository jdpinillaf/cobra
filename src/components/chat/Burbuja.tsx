/**
 * Burbuja de chat.
 *
 * Estaba adentro de `Telefono.tsx` y era privada. Se extrae porque la bandeja
 * necesita exactamente la misma burbuja: si la consola dibujara las suyas, dos
 * definiciones de "cómo se ve un mensaje" se irían separando sin que nadie lo
 * note hasta que se ven una al lado de la otra.
 *
 * La estética es la de una app de mensajería y no la del resto de la consola, a
 * propósito. El asesor está leyendo una conversación de WhatsApp; que se vea
 * como WhatsApp es lo que hace que no tenga que traducir mentalmente.
 */

export const VERDE_BURBUJA = '#D9FDD3'
export const FONDO_CHAT = '#EFE7DE'

export interface MensajeBurbuja {
  id: string
  /** `saliente` es la empresa (el agente o un asesor); `entrante` es el deudor. */
  direccion: 'entrante' | 'saliente'
  cuerpo: string
  hora: string
  autor?: string | null
}

export function Burbuja({ mensaje }: { mensaje: MensajeBurbuja }) {
  const delDeudor = mensaje.direccion === 'entrante'

  return (
    <div
      data-burbuja
      className={`animar-entrada max-w-[78%] px-3 py-2 text-[14px] leading-snug ${
        delDeudor
          ? 'self-start rounded-lg rounded-tl-none bg-white'
          : 'self-end rounded-lg rounded-tr-none'
      }`}
      style={delDeudor ? undefined : { background: VERDE_BURBUJA }}
    >
      {mensaje.autor && (
        <p className="mb-0.5 text-[11px] font-medium text-emerald-800">{mensaje.autor}</p>
      )}
      {/*
        Un cuerpo vacío es un caso real, no un error: WhatsApp entrega mensajes
        sin texto cuando llega una imagen, un audio o un adjunto que todavía no
        sabemos leer. Dibujar una burbuja en blanco deja al asesor sin saber si
        el deudor mandó algo o si la pantalla se rompió.
      */}
      {mensaje.cuerpo ? (
        <p className="whitespace-pre-wrap break-words text-neutral-900">{mensaje.cuerpo}</p>
      ) : (
        <p className="italic text-neutral-500">mensaje sin texto</p>
      )}
      <p className="mt-0.5 text-right text-[10px] text-neutral-500" data-cifra>
        {mensaje.hora}
      </p>
    </div>
  )
}

/**
 * Un intento que la ley bloqueó.
 *
 * No es un mensaje: nunca salió. Se muestra igual, y centrado como un separador,
 * porque es la evidencia de que el sistema respetó la Ley 2300 y porque el
 * asesor necesita entender por qué hay un hueco de tres días en la conversación.
 */
export function Bloqueado({ motivo, hora }: { motivo: string; hora: string }) {
  return (
    <div className="my-1 self-center rounded bg-black/5 px-2.5 py-1 text-center text-[11px] text-neutral-600">
      No se contactó · {motivo.replace(/_/g, ' ')} · <span data-cifra>{hora}</span>
    </div>
  )
}

/** Nota interna. Nunca sale hacia el deudor, y tiene que verse distinta. */
export function Nota({ cuerpo, autor, hora }: { cuerpo: string; autor: string | null; hora: string }) {
  return (
    <div className="my-1 max-w-[85%] self-center border-l-2 border-diferido bg-[#FFF8E1] px-3 py-2 text-[13px] text-neutral-800">
      <p className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-500">
        Nota interna{autor ? ` · ${autor}` : ''} · <span data-cifra>{hora}</span>
      </p>
      <p className="whitespace-pre-wrap break-words">{cuerpo}</p>
    </div>
  )
}
