const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

export const cop = (monto: number): string => COP.format(monto)

/**
 * Pesos abreviados para cifras grandes en tablas angostas. Un prestamista lee
 * "$ 456,9 M" más rápido que "$ 456.864.844", y en móvil lo segundo no cabe.
 */
export function copCorto(monto: number): string {
  const abs = Math.abs(monto)
  if (abs >= 1_000_000_000) return `$ ${(monto / 1_000_000_000).toFixed(1).replace('.', ',')} MM`
  if (abs >= 1_000_000) return `$ ${(monto / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (abs >= 1_000) return `$ ${Math.round(monto / 1_000)} k`
  return COP.format(monto)
}

export const numero = (n: number): string => NUMERO.format(n)

export const pct = (fraccion: number, decimales = 1): string =>
  `${(fraccion * 100).toFixed(decimales).replace('.', ',')} %`

export const puntos = (n: number, decimales = 1): string =>
  `${n.toFixed(decimales).replace('.', ',')}`
