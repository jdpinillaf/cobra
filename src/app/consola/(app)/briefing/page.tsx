import { Suspense } from 'react'
import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { obtenerDb } from '@/repo/conexion'
import { llamadasConResumen, type LlamadaConResumen } from '@/repo/cobranza/llamadas'
import { armarBriefing, totalesDe } from '@/voz/briefing'
import { Estado } from '@/components/consola/Tabla'
import { cop, numero } from '@/lib/formato'

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

const reloj = (seg: number | null): string =>
  seg === null ? '—' : `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`

export default async function PaginaBriefing() {
  const sesion = await requerirSesion()
  const db = await obtenerDb()
  const llamadas = await llamadasConResumen(db, sesion.tenantId)

  if (llamadas.length === 0) {
    return (
      <div className="max-w-prose">
        <h1 className="font-serif text-title">Briefing</h1>
        <p className="mt-4 text-ink-soft">
          Todavía no hay llamadas que resumir. Cuando el agente haya llamado, acá aparece qué
          pasó y a quién conviene llamar primero.
        </p>
      </div>
    )
  }

  const t = totalesDe(
    llamadas.map((l) => ({
      deudor: l.deudorNombre,
      resultado: l.resultado,
      resumen: l.resumen,
      duracionSeg: l.duracionSeg,
      costoCop: l.costoCop,
      acciones: l.acciones,
      dichoPorElDeudor: l.dichoPorElDeudor,
    })),
  )

  return (
    <div>
      <h1 className="font-serif text-title">Briefing</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        Lo que pasó en las llamadas, leído de arriba. Las cifras salen del sistema; el agente
        agrupa, nombra el patrón y dice por dónde seguir.
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
        <Metrica etiqueta="Llamadas" valor={numero(t.llamadas)} />
        <Metrica etiqueta="Cerraron con link" valor={numero(t.conLink)} />
        <Metrica etiqueta="Pasaron a una persona" valor={numero(t.escaladas)} />
        <Metrica etiqueta="Pidieron la baja" valor={numero(t.bajas)} />
        <Metrica etiqueta="Minutos" valor={numero(t.minutos)} />
        <Metrica etiqueta="Costo" valor={cop(t.costoCop)} />
      </dl>

      {/*
        El briefing llega en streaming: pedirle un resumen a un modelo tarda unos
        segundos, y bloquear la pantalla entera por eso dejaría al asesor mirando
        un spinner con las grabaciones ya listas debajo.
      */}
      <Suspense fallback={<Pensando />}>
        <ElBriefing llamadas={llamadas} />
      </Suspense>

      <section className="mt-10">
        <p className="marca-seccion">Las conversaciones, una por una</p>
        <div className="mt-3">
          {llamadas.map((l) => (
            <Conversacion key={l.id} llamada={l} />
          ))}
        </div>
      </section>
    </div>
  )
}

async function ElBriefing({ llamadas }: { llamadas: LlamadaConResumen[] }) {
  const { briefing } = await armarBriefing(
    llamadas.map((l) => ({
      deudor: l.deudorNombre,
      resultado: l.resultado,
      resumen: l.resumen,
      duracionSeg: l.duracionSeg,
      costoCop: l.costoCop,
      acciones: l.acciones,
      dichoPorElDeudor: l.dichoPorElDeudor,
    })),
  )

  return (
    <>
      <section className="mt-10">
        <p className="marca-seccion">§01 · Lo primero</p>
        <p className="mt-3 max-w-prose font-serif text-lead">{briefing.titular}</p>
        <p className="mt-3 max-w-prose text-ink-soft">{briefing.loQueFuncionó}</p>
      </section>

      {briefing.loQueSeRepite.length > 0 && (
        <section className="mt-10">
          <p className="marca-seccion">§02 · Lo que se repite</p>
          <div className="mt-3 max-w-prose">
            {briefing.loQueSeRepite.map((o, i) => (
              <div key={i} className="border-b border-rule py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-ink">«{o.objecion}»</p>
                  <span className="shrink-0 tabular-nums text-sm text-ink-faint">
                    {o.cuantas} {o.cuantas === 1 ? 'llamada' : 'llamadas'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{o.queHacer}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {briefing.aQuienLlamarPrimero.length > 0 && (
        <section className="mt-10">
          <p className="marca-seccion">§03 · A quién llamar primero</p>
          <ol className="mt-3 max-w-prose">
            {briefing.aQuienLlamarPrimero.map((a, i) => (
              <li key={i} className="border-b border-rule py-3 last:border-0">
                <span className="text-ink">{a.deudor}</span>
                <span className="text-ink-soft"> — {a.porque}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-10">
        <p className="marca-seccion">§04 · Lo que hay que arreglar</p>
        <p className="mt-3 max-w-prose text-ink">{briefing.loQueHayQueArreglar}</p>
        <p className="mt-3 max-w-prose text-sm text-ink-faint">
          Esta parte es sobre el agente, no sobre los deudores. Es lo que se corrige antes de
          la próxima tanda.
        </p>
      </section>
    </>
  )
}

function Conversacion({ llamada }: { llamada: LlamadaConResumen }) {
  const r = RESULTADO[llamada.resultado ?? ''] ?? { texto: llamada.estado, tono: 'neutro' as const }

  return (
    <article className="border-b border-rule py-5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Link href={`/consola/llamadas/${llamada.id}`} className="text-ink underline underline-offset-4">
          {llamada.deudorNombre}
        </Link>
        <Estado tono={r.tono}>{r.texto}</Estado>
        <span className="tabular-nums text-sm text-ink-faint">{reloj(llamada.duracionSeg)}</span>
        <span className="ml-auto tabular-nums text-sm text-ink-faint">{cop(llamada.costoCop)}</span>
      </div>

      {llamada.resumen && <p className="mt-2 max-w-prose text-ink-soft">{llamada.resumen}</p>}

      {llamada.grabacionUrl && (
        <audio controls preload="none" src={llamada.grabacionUrl} className="mt-3 w-full max-w-md" />
      )}

      {llamada.acciones.length > 0 && (
        <p className="mt-2 text-sm text-ink-faint">{llamada.acciones.join(' · ')}</p>
      )}
    </article>
  )
}

function Pensando() {
  return (
    <section className="mt-10">
      <p className="marca-seccion">§01 · Lo primero</p>
      <p className="mt-3 max-w-prose text-ink-faint">El agente está leyendo las llamadas…</p>
    </section>
  )
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">{etiqueta}</dt>
      <dd className="mt-1 text-lead tabular-nums">{valor}</dd>
    </div>
  )
}
