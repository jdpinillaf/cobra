import Script from 'next/script'
import { MARCA } from '@/lib/marca'

export function Agendar() {
  return (
    <section id="agendar" className="scroll-mt-24">
      <p className="marca-seccion">§04 · Agendar</p>
      <h2 className="mt-4 max-w-[20ch] text-title">
        Traé un proceso real y lo configuramos <em className="font-serif italic">en vivo</em>.
      </h2>
      <p className="medida mt-5 text-ink-soft">
        Treinta minutos con tus datos reales. Te mostramos qué haría el agente y qué no. Si no
        cuadra, te lo decimos ahí mismo.
      </p>
      {/*
        Lo que queda de la sección de precios. No hay tabla porque no hay
        producto empaquetado: el alcance se define en esta llamada.
      */}
      <p className="medida mt-4 text-sm text-ink-faint">
        Implementación uno a uno. Cada agente se cotiza por el proceso que reemplaza; no hay tabla
        de planes porque no hay dos operaciones iguales.
      </p>

      <div className="mt-12 border-t border-ink pt-8">
        {MARCA.calendly ? (
          <>
            <div
              className="calendly-inline-widget"
              data-url={MARCA.calendly}
              style={{ minWidth: '320px', height: '680px' }}
            />
            <Script
              src="https://assets.calendly.com/assets/external/widget.js"
              strategy="lazyOnload"
            />
          </>
        ) : (
          /*
            Sin link de Calendly configurado, un iframe vacío se ve como un
            error. Mejor mostrar la vía que sí funciona.
          */
          <div>
            <p className="text-lead">
              Escríbenos a{' '}
              <a
                href={`mailto:${MARCA.correo}?subject=Demo%20de%20${MARCA.nombre}`}
                className="underline underline-offset-4 transition-opacity hover:opacity-70"
              >
                {MARCA.correo}
              </a>{' '}
              y coordinamos.
            </p>
            <p className="mt-4 text-xs text-ink-faint">
              Cuéntanos qué proceso quieres delegar y con qué volumen. Con eso llegamos a la llamada
              sabiendo de qué hablar.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
