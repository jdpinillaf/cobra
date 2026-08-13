import { Agendar } from '@/components/landing/Agendar'
import { Agentes } from '@/components/landing/Agentes'
import DemoAgente from '@/components/landing/demo/DemoAgente'
import { Footer } from '@/components/landing/Footer'
import { Hero } from '@/components/landing/Hero'
import { Nav } from '@/components/landing/Nav'
import { Observabilidad } from '@/components/landing/Observabilidad'

/**
 * La página entera es servidor. La única isla de cliente es la demo, y pesa lo
 * que pesa su guion: el motor de cartera dejó de entrar al bundle del visitante
 * cuando salió el simulador de la landing. Sigue vivo en `pnpm demo`.
 */
export default function Page() {
  return (
    <>
      <Nav />

      <main className="mx-auto max-w-6xl px-6">
        <Hero />

        {/*
          La demo va primero y arranca sola. Es el gancho: el visitante ve cómo
          se arma un agente y cómo trabaja antes de que se le pida nada.
        */}
        <section id="demo" className="scroll-mt-24">
          <p className="marca-seccion">§01 · La demo</p>
          <h2 className="mt-4 max-w-[22ch] text-title">
            De un prompt a un <em className="font-serif italic">caso cerrado</em>.
          </h2>
          <p className="medida mt-5 text-ink-soft">
            Primero lo configuras. Después lo miras trabajar.
          </p>

          <div className="mt-12">
            <DemoAgente />
          </div>

          {/*
            Objeción número uno cuando el agente cobra: el visitante acaba de
            ver un link de pago generarse, así que la respuesta va aquí y no
            tres secciones más abajo.
          */}
          <p className="medida mt-10 text-lead">
            La plata <em className="font-serif italic">nunca</em> pasa por nosotros. La cuenta de
            recaudo es tuya.
          </p>
        </section>

        <div className="mt-28 sm:mt-36">
          <Agentes />
        </div>

        <div className="mt-28 sm:mt-36">
          <Observabilidad />
        </div>

        <div className="mt-28 sm:mt-36">
          <Agendar />
        </div>
      </main>

      <Footer />
    </>
  )
}
