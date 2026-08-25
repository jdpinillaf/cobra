import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { Cruce } from '@/components/consola/conciliacion/Cruce'
import { Portales } from '@/components/consola/conciliacion/Portales'

export const dynamic = 'force-dynamic'

const MODOS = [
  { clave: 'portales', label: 'Entre portales' },
  { clave: 'archivos', label: 'Dos archivos' },
] as const

export default async function PaginaConciliacion({
  searchParams,
}: {
  searchParams?: Promise<{ modo?: string }>
}) {
  await requerirSesion()
  const parametros = (await searchParams) ?? {}
  // Lista blanca antes de decidir nada: el modo viene de la URL.
  const modo = parametros.modo === 'archivos' ? 'archivos' : 'portales'

  return (
    <div>
      <h1 className="font-serif text-title">Conciliación</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        {modo === 'portales'
          ? 'Cruzamos lo que dice su software contable, lo que dice el banco y lo que dice su Excel. Le decimos cuánta plata está en juego y cuál de los tres se salió.'
          : 'Suba dos archivos del mismo dinero. Le decimos cuántos pesos están en uno y no en el otro, y en qué filas.'}
      </p>

      <nav className="mt-5 flex gap-5 border-b border-rule pb-2">
        {MODOS.map((m) => (
          <Link
            key={m.clave}
            href={`/consola/conciliacion?modo=${m.clave}`}
            className={
              modo === m.clave
                ? 'text-ink underline underline-offset-4'
                : 'text-ink-faint hover:text-ink-soft'
            }
          >
            {m.label}
          </Link>
        ))}
      </nav>

      {modo === 'portales' ? <Portales /> : <Cruce />}
    </div>
  )
}
