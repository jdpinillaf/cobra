import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { obtenerDb } from '@/repo/conexion'
import { listarLlamadas, type LlamadaEnLista } from '@/repo/cobranza/llamadas'
import { Celda, Encabezado, Estado, Tabla } from '@/components/consola/Tabla'
import { cop, numero } from '@/lib/formato'

export const dynamic = 'force-dynamic'

const COLUMNAS = [
  { clave: 'cuando', label: 'Cuándo' },
  { clave: 'deudor', label: 'Deudor' },
  { clave: 'duracion', label: 'Duración', num: true },
  { clave: 'resultado', label: 'En qué quedó' },
  { clave: 'costo', label: 'Costo', num: true },
]

/**
 * Cómo se lee cada final de llamada.
 *
 * El tono no es decorativo: es lo que le dice al asesor a quién volver a
 * llamar. `escalado` va en ámbar porque **hay algo que hacer**; `numero_errado`
 * en rojo porque hay que corregir la cartera, no insistir.
 */
const RESULTADO: Record<string, { texto: string; tono: 'entregado' | 'diferido' | 'bloqueado' | 'neutro' }> = {
  acuerdo: { texto: 'Acuerdo y link enviado', tono: 'entregado' },
  promesa: { texto: 'Acuerdo sin link', tono: 'diferido' },
  escalado: { texto: 'Pasó a una persona', tono: 'diferido' },
  sin_acuerdo: { texto: 'Sin acuerdo', tono: 'neutro' },
  numero_errado: { texto: 'Número errado', tono: 'bloqueado' },
  sin_contacto: { texto: 'Buzón · nadie contestó', tono: 'bloqueado' },
  baja: { texto: 'Pidió la baja', tono: 'bloqueado' },
}

const duracion = (seg: number | null): string => {
  if (seg === null) return '—'
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}

const cuando = (iso: string): string =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export default async function PaginaLlamadas() {
  const sesion = await requerirSesion()
  const db = await obtenerDb()
  const llamadas = await listarLlamadas(db, sesion.tenantId)

  if (llamadas.length === 0) {
    return (
      <div className="max-w-prose">
        <h1 className="font-serif text-title">Llamadas</h1>
        <p className="mt-4 text-ink-soft">
          Todavía no hay llamadas. El agente marca desde la conversación, o con{' '}
          <code className="text-ink">pnpm llamar</code>.
        </p>
      </div>
    )
  }

  const cerradas = llamadas.filter((l) => l.resultado === 'acuerdo')
  const segundos = llamadas.reduce((t, l) => t + (l.duracionSeg ?? 0), 0)
  const costo = llamadas.reduce((t, l) => t + l.costoCop, 0)

  return (
    <div>
      <h1 className="font-serif text-title">Llamadas</h1>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
        <Metrica etiqueta="Llamadas" valor={numero(llamadas.length)} />
        <Metrica etiqueta="Cerraron con link" valor={numero(cerradas.length)} />
        <Metrica etiqueta="Minutos" valor={numero(Math.ceil(segundos / 60))} />
        <Metrica etiqueta="Costo" valor={cop(costo)} />
      </dl>

      <section className="mt-8">
        <p className="marca-seccion">Qué pasó en cada una</p>
        <div className="mt-3">
          <Tabla>
            <Encabezado columnas={COLUMNAS} />
            <tbody>
              {llamadas.map((l) => (
                <Fila key={l.id} llamada={l} />
              ))}
            </tbody>
          </Tabla>
        </div>
        <p className="mt-3 max-w-prose text-sm text-ink-faint">
          El costo incluye telefonía, grabación y el minuto de IA. Twilio factura el minuto
          redondeado hacia arriba, así que una llamada de 1:05 cuesta como dos minutos.
        </p>
      </section>
    </div>
  )
}

function Fila({ llamada }: { llamada: LlamadaEnLista }) {
  const r = RESULTADO[llamada.resultado ?? ''] ?? { texto: llamada.estado, tono: 'neutro' as const }
  return (
    <tr className="border-b border-rule hover:bg-paper-deep">
      <Celda suave>{cuando(llamada.iniciadaEn)}</Celda>
      <Celda>
        <Link href={`/consola/llamadas/${llamada.id}`} className="underline underline-offset-4">
          {llamada.deudorNombre}
        </Link>
        <span className="block text-ink-faint">{llamada.telefono}</span>
      </Celda>
      <Celda num>{duracion(llamada.duracionSeg)}</Celda>
      <Celda>
        <Estado tono={r.tono}>{r.texto}</Estado>
        {llamada.proveedor === 'simulado' && (
          <span className="ml-2 text-marca uppercase tracking-[0.14em] text-ink-faint">simulada</span>
        )}
      </Celda>
      <Celda num suave>{cop(llamada.costoCop)}</Celda>
    </tr>
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
