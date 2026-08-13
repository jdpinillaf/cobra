import { MARCA } from '@/lib/marca'

export function Footer() {
  return (
    <footer className="mt-32 border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-lg tracking-tight">{MARCA.nombre}</p>
          <p className="mt-1 text-sm text-ink-faint">{MARCA.descriptor}</p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-soft">
          <a href="#agentes" className="transition-colors hover:text-ink">
            Los agentes
          </a>
          <a href="#observabilidad" className="transition-colors hover:text-ink">
            Observabilidad
          </a>
          <a href={`mailto:${MARCA.correo}`} className="transition-colors hover:text-ink">
            {MARCA.correo}
          </a>
        </div>
      </div>
    </footer>
  )
}
