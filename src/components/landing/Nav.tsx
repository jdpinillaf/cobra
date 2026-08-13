import { MARCA } from '@/lib/marca'

const ENLACES = [
  { href: '#demo', texto: 'La demo' },
  { href: '#agentes', texto: 'Los agentes' },
  { href: '#observabilidad', texto: 'Observabilidad' },
] as const

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/85 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="text-lg tracking-tight">
          {MARCA.nombre}
        </a>

        <div className="hidden items-center gap-8 text-sm text-ink-soft md:flex">
          {ENLACES.map((e) => (
            <a key={e.href} href={e.href} className="transition-colors hover:text-ink">
              {e.texto}
            </a>
          ))}
        </div>

        <a
          href="#agendar"
          className="rounded-full bg-ink px-5 py-2 text-sm text-paper transition-opacity hover:opacity-85"
        >
          Agendar demo
        </a>
      </nav>
    </header>
  )
}
