import type { Metadata } from 'next'
import { Consola } from '@/components/demo/Consola'
import { vistaPorTelefono } from '@/demo/servicio'

/**
 * La demo se arma en el servidor con la conversación ya empezada: el
 * recordatorio de la cadencia aparece como si hubiera salido hace un minuto.
 * Abrir la pantalla en un chat vacío obligaría a explicar de dónde salió el
 * primer mensaje, y eso es tiempo perdido en una reunión de cuarenta minutos.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Demo · Agente de cobranza',
  robots: { index: false, follow: false },
}

export default async function PaginaDemo({
  searchParams,
}: {
  searchParams: Promise<{ limpio?: string }>
}) {
  const { limpio } = await searchParams
  const vista = vistaPorTelefono()

  if (!vista) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p className="text-ink-soft">
          No se pudo armar la cartera de la demo. Revisa <code>src/demo/estado.ts</code>.
        </p>
      </main>
    )
  }

  return (
    <main>
      <Consola inicial={vista} limpio={limpio === '1'} />
    </main>
  )
}
