import { ingerirCorreo } from '@/conciliacion/correo/pipeline'
import { crearVerificador } from '@/conciliacion/correo/verificador'
import { conTenant } from '@/repo/con-tenant'
import { obtenerDb } from '@/repo/conexion'
import { tenantPorAlias } from '@/repo/tenants'

/**
 * La otra mitad entrante del producto: el aviso del banco.
 *
 * Llega desde el Email Worker de Cloudflare, que recibe el correo reenviado
 * desde el Gmail del cliente y lo empuja acá tal como vino.
 *
 * La ruta se queda con lo que solo ella puede hacer —autenticar al Worker,
 * leer los bytes, responder HTTP— y delega todo lo demás a `ingerirCorreo`,
 * que se prueba contra PGlite sin levantar servidor. Es el mismo reparto que
 * el webhook de WhatsApp.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * El alias viene por cabecera y **no** se saca del `To:` del correo.
 *
 * Es contraintuitivo y es la clase de detalle que cuesta media jornada: cuando
 * Gmail reenvía, las cabeceras del original quedan intactas, así que el `To:`
 * sigue diciendo el correo del cliente y el alias no aparece por ningún lado
 * del texto. El alias vive en el **sobre** —el `RCPT TO` de SMTP—, que es lo
 * que el Worker recibe como destinatario y lo único que sabe a qué tenant va.
 *
 * Confiar en la cabecera no abre nada: el request ya viene autenticado con el
 * secreto compartido, así que quien la escribe es el Worker.
 */
const CABECERA_ALIAS = 'x-alias-destino'

function autorizado(request: Request): boolean {
  const esperado = process.env.CORREO_SECRETO
  // Sin secreto configurado no se atiende. Un buzón abierto a internet que
  // además acepta POST de cualquiera es dos agujeros, no uno.
  if (!esperado) return false
  return (request.headers.get('authorization') ?? '') === `Bearer ${esperado}`
}

export async function POST(request: Request): Promise<Response> {
  if (!autorizado(request)) return new Response('No autorizado', { status: 401 })

  const alias = request.headers.get(CABECERA_ALIAS)?.trim()
  if (!alias) return new Response(`Falta ${CABECERA_ALIAS}`, { status: 400 })

  // **Los bytes exactos.** El cuerpo va como `application/octet-stream` y no
  // envuelto en JSON: DKIM se calcula sobre estos bytes y una conversión de
  // charset rompe el hash del cuerpo, con lo que la firma falla siempre y sin
  // motivo aparente.
  const crudo = await request.text()
  if (crudo.trim() === '') return new Response('Cuerpo vacío', { status: 400 })

  const db = await obtenerDb()
  const tenant = await tenantPorAlias(db, alias)

  if (!tenant) {
    // 202 y no 404: responder distinto según si el alias existe le diría a
    // quien pruebe cuáles son válidos, y los alias son impredecibles justamente
    // para que no se puedan enumerar. El Worker ya descartó lo que no existe;
    // llegar acá significa que el alias se dio de baja en el medio.
    console.warn('[correo] alias sin tenant activo')
    return new Response(null, { status: 202 })
  }

  try {
    const resultado = await conTenant(db, tenant.id, (tx) =>
      ingerirCorreo(tx, { tenant, crudo, verificador: crearVerificador() }),
    )

    if (resultado.alerta) {
      // El detector más urgente de los tres: si esto aparece, Bancolombia
      // cambió la redacción y **todos** los clientes dejan de conciliar el
      // mismo día. No hay diversificación de bancos que amortigüe.
      console.error(
        `[correo] no se pudo leer un aviso auténtico de ${tenant.nombre}: ${resultado.motivo}`,
      )
    }

    return Response.json({ estado: resultado.estado, motivo: resultado.motivo })
  } catch (e) {
    // Se responde 200 igual, por el mismo motivo que el webhook de Meta: si el
    // payload es el que rompe, el reintento vuelve a romper y se entra en un
    // bucle. El correo no se pierde —Cloudflare lo entregó y el fallo queda
    // registrado— y se resuelve por fuera del ciclo de la entrega.
    console.error('[correo] fallo procesando un correo ya autenticado', e)
    return Response.json({ estado: 'error' }, { status: 200 })
  }
}
