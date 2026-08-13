import type { Metadata } from 'next'
import { Instrument_Sans, Instrument_Serif } from 'next/font/google'
import { MARCA } from '@/lib/marca'
import './globals.css'

/**
 * Instrument Sans e Instrument Serif son de la misma fundición, así que el par
 * comparte proporciones y no se lee como dos fuentes juntadas a la fuerza.
 */
const sans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
  display: 'swap',
})

const serif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
})

const titulo = `${MARCA.nombre} — Agentes especializados para empresas`
const descripcion =
  'Construimos agentes que hacen el trabajo que tu operación no alcanza: cobranza, datos, soporte y back-office. Cada uno se configura con tus reglas y se conecta a tus herramientas.'

export const metadata: Metadata = {
  metadataBase: new URL(`https://${MARCA.dominio}`),
  title: titulo,
  description: descripcion,
  openGraph: {
    title: titulo,
    description: descripcion,
    locale: 'es_CO',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-CO" className={`${sans.variable} ${serif.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
