import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirSesion } from '@/auth/actual'
import { obtenerDb } from '@/repo/conexion'
import { llamadaConDetalle } from '@/repo/cobranza/llamadas'
import { Estado } from '@/components/consola/Tabla'
import { cop } from '@/lib/formato'

export const dynamic = 'force-dynamic'

const RESULTADO: Record<string, { texto: string; tono: 'entregado' | 'diferido' | 'bloqueado' | 'neutro' }> = {
  acuerdo: { texto: 'Acuerdo y link enviado', tono: 'entregado' },
  promesa: { texto: 'Acuerdo sin link', tono: 'diferido' },
  escalado: { texto: 'Pasó a una persona', tono: 'diferido' },
  sin_acuerdo: { texto: 'Sin acuerdo', tono: 'neutro' },
  numero_errado: { texto: 'Número errado', tono: 'bloqueado' },
  sin_contacto: { texto: 'Buzón · nadie contestó', tono: 'bloqueado' },
  baja: { texto: 'Pidió la baja', tono: 'bloqueado' },
}

const ESTADO_ACCION: Record<string, { texto: string; tono: 'entregado' | 'diferido' | 'bloqueado' }> = {
  ok: { texto: 'ejecutada', tono: 'entregado' },
  // No es una falla: la herramienta corrió y dijo que no. Es el producto
  // funcionando, y es lo que prueba que los límites del cliente mandan.
  bloqueado: { texto: 'rechazada por los límites', tono: 'diferido' },
  error: { texto: 'falló', tono: 'bloqueado' },
}

const reloj = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default async function PaginaLlamada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sesion = await requerirSesion()
  const db = await obtenerDb()
  const llamada = await llamadaConDetalle(db, sesion.tenantId, id)
  if (!llamada) notFound()

  const r = RESULTADO[llamada.resultado ?? ''] ?? { texto: llamada.estado, tono: 'neutro' as const }
  const minutos = llamada.duracionSeg === null ? null : Math.ceil(llamada.duracionSeg / 60)

  return (
    <div>
      <Link href="/consola/llamadas" className="text-sm text-ink-soft underline underline-offset-4">
        ← Llamadas
      </Link>

      <h1 className="mt-4 font-serif text-title">{llamada.deudorNombre}</h1>
      <p className="mt-1 text-ink-soft">
        {llamada.telefono} ·{' '}
        {new Intl.DateTimeFormat('es-CO', {
          timeZone: 'America/Bogota',
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(new Date(llamada.iniciadaEn))}
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">En qué quedó</dt>
          <dd className="mt-1 text-lead">
            <Estado tono={r.tono}>{r.texto}</Estado>
          </dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Duración</dt>
          <dd className="mt-1 text-lead tabular-nums">
            {llamada.duracionSeg === null ? '—' : reloj(llamada.duracionSeg * 1000)}
          </dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Costo</dt>
          <dd className="mt-1 text-lead tabular-nums">{cop(llamada.costoCop)}</dd>
        </div>
        {minutos !== null && (
          <div>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Minutos facturados</dt>
            <dd className="mt-1 text-lead tabular-nums">{minutos}</dd>
          </div>
        )}
      </dl>

      {llamada.resumen && (
        <section className="mt-8">
          <p className="marca-seccion">§01 · Resumen</p>
          <p className="mt-3 max-w-prose text-ink">{llamada.resumen}</p>
        </section>
      )}

      {llamada.grabacionUrl && (
        <section className="mt-8">
          <p className="marca-seccion">§02 · La grabación</p>
          <audio controls src={llamada.grabacionUrl} className="mt-3 w-full max-w-md" />
        </section>
      )}

      <section className="mt-8">
        <p className="marca-seccion">
          §{llamada.grabacionUrl ? '03' : '02'} · La conversación
        </p>
        <div className="mt-3 max-w-prose">
          {llamada.turnos.length === 0 ? (
            <p className="text-ink-soft">Nadie llegó a hablar.</p>
          ) : (
            llamada.turnos.map((t) => (
              <div key={t.indice} className="border-b border-rule py-3 last:border-0">
                <div className="flex items-baseline gap-3">
                  <span className="w-20 shrink-0 text-marca uppercase tracking-[0.14em] text-ink-faint">
                    {t.quien === 'agente' ? 'Agente' : t.quien === 'deudor' ? 'Deudor' : 'Sistema'}
                  </span>
                  <p className="text-ink">
                    {t.texto}
                    {t.interrumpido && (
                      /*
                        Sin esta marca la transcripción miente: muestra la frase
                        entera cuando el deudor solo alcanzó a oír el principio.
                      */
                      <span className="ml-2 text-sm text-diferido">— lo interrumpió</span>
                    )}
                  </p>
                  <span className="ml-auto shrink-0 tabular-nums text-sm text-ink-faint">
                    {reloj(t.msDesdeInicio)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <p className="marca-seccion">
          §{llamada.grabacionUrl ? '04' : '03'} · Qué ejecutó el agente
        </p>
        <div className="mt-3 max-w-prose">
          {llamada.acciones.length === 0 ? (
            <p className="text-ink-soft">No llamó a ninguna herramienta.</p>
          ) : (
            llamada.acciones.map((a, i) => {
              const e = ESTADO_ACCION[a.estado]
              return (
                <div key={i} className="border-b border-rule py-3 last:border-0">
                  <div className="flex items-baseline gap-3">
                    <span className="font-medium text-ink">{a.herramienta}</span>
                    <Estado tono={e.tono}>{e.texto}</Estado>
                    {/* En una llamada simulada no hay red que medir; un «0 ms»
                        se lee como instantáneo y no como ausencia de dato. */}
                    {a.latenciaMs !== null && a.latenciaMs > 0 && (
                      <span className="ml-auto tabular-nums text-sm text-ink-faint">{a.latenciaMs} ms</span>
                    )}
                  </div>
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words text-sm text-ink-soft">
                    {JSON.stringify(a.argumentos, null, 0)}
                  </pre>
                </div>
              )
            })
          )}
        </div>
        <p className="mt-3 max-w-prose text-sm text-ink-faint">
          El modelo <em>pide</em> estas acciones; quien las aprueba es el código, contra los
          límites que usted autorizó por tramo de mora. Una rechazada no es un error: es el
          agente sin autorización para conceder lo que le pidieron.
        </p>
      </section>
    </div>
  )
}
