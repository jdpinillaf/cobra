import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Checkout } from '@/components/demo/Checkout'
import { estadoDemo } from '@/demo/estado'

/**
 * La página a la que lleva el link que manda el agente.
 *
 * Se sirve desde el servidor con los datos del cobro ya resueltos: en una demo,
 * un spinner de dos segundos en el paso del pago rompe el ritmo justo en el
 * momento que importa.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pago',
  robots: { index: false, follow: false },
}

export default async function PaginaPago({
  params,
}: {
  params: Promise<{ referencia: string }>
}) {
  const { referencia } = await params
  const estado = estadoDemo()
  const pago = estado.pagos.get(referencia)
  if (!pago) notFound()

  const obligacion = estado.cartera.obligaciones.find((o) => o.id === pago.obligacionId)
  const deudor = estado.cartera.deudores.find((d) => d.id === obligacion?.deudorId)

  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 py-14">
      <Checkout
        referencia={referencia}
        monto={pago.monto}
        comercio={estado.cartera.cliente.nombre}
        deudor={deudor?.nombre ?? null}
        numeroCredito={obligacion?.numeroCredito ?? null}
        saldoTotal={obligacion?.saldoTotal ?? null}
        yaPagado={pago.estado === 'aprobado'}
      />
    </main>
  )
}
