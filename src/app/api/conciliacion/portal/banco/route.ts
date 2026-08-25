import { comoPortalBanco, generarCarteraDemo } from '@/demo/portales'

/**
 * Un portal bancario de mentira. Otra forma distinta a propósito: el arreglo
 * cuelga de `resultado.movimientos`, los campos van en español con mayúscula y
 * los montos llegan como texto con separador de miles.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(comoPortalBanco(generarCarteraDemo().banco))
}
