import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { MARCA } from '@/lib/marca'

/**
 * Marco de la consola.
 *
 * Las pestañas se van llenando a medida que existe qué mostrar. Las que
 * todavía no tienen datos aparecen apagadas y sin enlace: es más honesto que
 * una pantalla vacía que parece rota, y sirve de mapa de lo que falta.
 */
const SECCIONES = [
  { href: '/consola/cartera', label: 'Cartera', listo: true },
  { href: '/consola/conversaciones', label: 'Conversaciones', listo: true },
  { href: '/consola/consumo', label: 'Consumo', listo: true },
  { href: '/consola/cumplimiento', label: 'Cumplimiento', listo: false },
]

export default async function LayoutConsola({ children }: { children: React.ReactNode }) {
  // La verificación va acá y no en un middleware: `cookies()` funciona igual en
  // server components y en rutas, y el middleware corre en Edge, donde no está
  // `node:crypto` y habría que mantener dos implementaciones del mismo HMAC.
  const sesion = await requerirSesion()

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-5 py-4">
          <Link href="/consola/cartera" className="font-serif text-lg">
            {MARCA.nombre}
          </Link>
          <nav className="flex flex-wrap items-baseline gap-4 text-sm">
            {SECCIONES.map((s) =>
              s.listo ? (
                <Link key={s.href} href={s.href} className="text-ink-soft hover:text-ink">
                  {s.label}
                </Link>
              ) : (
                <span key={s.href} className="text-ink-faint" title="todavía no hay datos que mostrar">
                  {s.label}
                </span>
              ),
            )}
          </nav>
          <p className="ml-auto text-sm text-ink-faint">{sesion.usuarioId.slice(0, 8)}</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}
