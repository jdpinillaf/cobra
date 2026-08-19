import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { listarBandeja, type FiltroBandeja } from '@/repo/cobranza/conversaciones'
import { obtenerDb } from '@/repo/conexion'
import { fechaCorta, horaDeReloj } from '@/components/demo/hora'

export const dynamic = 'force-dynamic'

const FILTROS: Array<{ clave: FiltroBandeja; label: string }> = [
  { clave: 'todas', label: 'Todas' },
  { clave: 'mias', label: 'Mías' },
  { clave: 'sin_asignar', label: 'Sin asignar' },
  { clave: 'pausadas', label: 'Pausadas' },
]

const TONO: Record<string, string> = {
  entregado: 'text-entregado',
  diferido: 'text-diferido',
  bloqueado: 'text-bloqueado',
  neutro: 'text-ink-soft',
}

/**
 * Bandeja: la lista vive en el layout, no en la página.
 *
 * Así al abrir un hilo la lista no se vuelve a montar ni pierde el scroll, que
 * es la diferencia entre sentirse una app de mensajería y sentirse una web con
 * páginas. Es lo mismo que hace cualquier cliente de correo.
 */
export default async function LayoutConversaciones({
  children,
  searchParams,
}: {
  children: React.ReactNode
  searchParams?: Promise<{ filtro?: string }>
}) {
  const sesion = await requerirSesion()
  const db = await obtenerDb()
  const parametros = (await searchParams) ?? {}
  const filtro = (FILTROS.find((f) => f.clave === parametros.filtro)?.clave ?? 'todas') as FiltroBandeja

  const hilos = await listarBandeja(db, sesion.tenantId, { usuarioId: sesion.usuarioId, filtro })
  const sinLeer = hilos.filter((h) => h.sinLeer).length

  return (
    <div className="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-rule lg:h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:border-r lg:pr-4">
        <div className="flex items-baseline justify-between">
          <h1 className="font-serif text-lead">Conversaciones</h1>
          {sinLeer > 0 && (
            <span className="text-marca uppercase tracking-[0.14em] text-bloqueado">
              {sinLeer} sin leer
            </span>
          )}
        </div>

        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {FILTROS.map((f) => (
            <Link
              key={f.clave}
              href={`/consola/conversaciones?filtro=${f.clave}`}
              className={filtro === f.clave ? 'text-ink underline underline-offset-4' : 'text-ink-faint hover:text-ink-soft'}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        <ul className="mt-4">
          {hilos.length === 0 && (
            <li className="py-6 text-sm text-ink-faint">Nada acá. Probá otro filtro.</li>
          )}
          {hilos.map((h) => (
            <li key={h.id} className="border-b border-rule">
              <Link href={`/consola/conversaciones/${h.id}`} className="block py-3 hover:bg-paper-deep">
                <div className="flex items-baseline gap-2">
                  {h.sinLeer && (
                    <span aria-label="sin leer" className="size-1.5 shrink-0 rounded-full bg-bloqueado" />
                  )}
                  <span className={`min-w-0 flex-1 truncate ${h.sinLeer ? 'font-medium' : ''}`}>
                    {h.deudorNombre}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint" data-cifra>
                    {h.ultimoMensajeEn ? horaDeReloj(h.ultimoMensajeEn) : ''}
                  </span>
                </div>

                <p className="mt-0.5 truncate text-sm text-ink-soft">
                  {/*
                    `ultimoMensaje` puede ser cadena vacía (mensaje sin texto) o
                    null (hilo sin mensajes). Son dos cosas distintas y decir
                    "sin mensajes" en el primer caso es mentira.
                  */}
                  {h.ultimoMensaje === null ? (
                    <span className="italic text-ink-faint">sin mensajes</span>
                  ) : h.ultimoMensaje === '' ? (
                    <span className="italic text-ink-faint">mensaje sin texto</span>
                  ) : (
                    h.ultimoMensaje
                  )}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  {h.agentePausado && <span className="text-diferido">agente pausado</span>}
                  <span className="text-ink-faint">
                    {h.asignadaNombre ?? 'sin asignar'}
                  </span>
                  {h.etiquetas.map((e) => (
                    <span key={e.nombre} className={TONO[e.tono] ?? TONO.neutro}>
                      {e.nombre}
                    </span>
                  ))}
                  {h.ultimoMensajeEn && (
                    <span className="ml-auto text-ink-faint" data-cifra>
                      {fechaCorta(h.ultimoMensajeEn)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="lg:h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pl-6">{children}</section>
    </div>
  )
}
