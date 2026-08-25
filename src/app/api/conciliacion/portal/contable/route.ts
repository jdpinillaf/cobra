import { comoPortalContable, generarCarteraDemo } from '@/demo/portales'

/**
 * Un portal contable de mentira, con la forma de uno de verdad.
 *
 * Sirve para mostrar la conciliación entre portales sin credenciales de nadie.
 * Devuelve el arreglo colgando de `data` y los campos en inglés, que es lo que
 * hacen Siigo y Alegra: si el demo devolviera exactamente lo que el cruce
 * espera, no probaría que el adaptador sirve.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(comoPortalContable(generarCarteraDemo().contable))
}
