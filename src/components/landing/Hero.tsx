import { Hero3D } from './hero3d/Hero3D'

export function Hero() {
  return (
    <section
      id="top"
      className="pt-20 pb-24 sm:pt-28 sm:pb-32 lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-10"
    >
      <div className="lg:col-span-7">
        <a
          href="#agentes"
          className="inline-flex items-center gap-2 rounded-full border border-rule px-4 py-1.5 text-xs text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
        >
          Cuatro agentes en operación
          <span aria-hidden>→</span>
        </a>

        {/*
          A 7 de 12 columnas, 16ch parte el titular en líneas muy cortas. El
          ancho de la columna ya hace de medida.
        */}
        <h1 className="mt-8 max-w-[13ch] text-display lg:max-w-none">
          El trabajo que tu operación{' '}
          <em className="font-serif italic">no alcanza a hacer</em>.
        </h1>

        {/*
          El pitch entero: no vendemos una plataforma para que armes algo, te
          entregamos el agente armado y corriendo contra tus herramientas.
        */}
        <p className="medida mt-8 text-lead text-ink-soft">
          Construimos agentes especializados: cobran, atienden, concilian y responden sobre tus
          datos. Cada uno se configura con tus reglas y trabaja contra tus propias herramientas.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#agendar"
            className="rounded-full bg-ink px-6 py-3 text-sm text-paper transition-opacity hover:opacity-85"
          >
            Agendar demo
          </a>
          <a
            href="#demo"
            className="rounded-full border border-rule-strong px-6 py-3 text-sm transition-colors hover:border-ink"
          >
            Ver uno construirse
          </a>
        </div>
      </div>

      {/* Solo en desktop: por debajo de `lg` ni siquiera se monta. */}
      <div className="hidden lg:col-span-5 lg:block">
        <Hero3D />
      </div>
    </section>
  )
}
