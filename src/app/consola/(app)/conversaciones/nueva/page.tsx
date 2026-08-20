import { requerirSesion } from '@/auth/actual'
import { FormularioAlta } from '@/components/consola/bandeja/FormularioAlta'

export const dynamic = 'force-dynamic'

export default async function PaginaNuevaConversacion() {
  // No usa la sesión más que para exigirla: el alta la resuelve la acción, que
  // vuelve a pedirla del lado del servidor. Acá es solo la puerta.
  await requerirSesion()
  return <FormularioAlta />
}
