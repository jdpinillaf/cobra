/**
 * Email Worker de Cloudflare: la puerta del buzón.
 *
 * Cloudflare Email Routing recibe el correo que el Gmail del cliente reenvía a
 * `<alias>@in.ponox.co` y llama a este Worker. El Worker hace **una sola cosa
 * cara y dos baratas**, y todo lo demás lo empuja al API.
 *
 * Vive fuera de `src/` porque no es la app de Next: se despliega aparte, con
 * `wrangler`, y corre en el runtime de Cloudflare. Es JavaScript y no
 * TypeScript por la misma razón — no comparte el `tsconfig` del repo.
 *
 * ## Por qué el alias se valida acá
 *
 * El buzón es **catch-all**: `loquesea@in.ponox.co` entra. Sin esta validación
 * cualquiera puede mandar mil correos a direcciones inventadas y llenar la base
 * de cuarentena, que además es uno de los tres detectores — se llenaría de
 * ruido justo el que avisa que alguien está probando.
 *
 * La lista de alias vigentes vive en KV, cacheada. Es una lectura barata; un
 * alias que no existe se descarta sin persistir y sin alertar.
 *
 * ## Por qué DKIM **no** se verifica acá
 *
 * Verificar una firma quema CPU y resuelve DNS, y el Worker tiene un techo bajo
 * de las dos cosas. La verificación va en el API, donde no hay ese techo. Acá
 * solo se decide si el correo entra al sistema.
 *
 * ## El cuerpo va como bytes, sin envolver
 *
 * DKIM se calcula sobre los bytes exactos que llegaron. Envolverlo en JSON, o
 * dejar que algo reinterprete el charset, rompe el hash del cuerpo y hace que
 * la firma falle siempre, sin motivo aparente. Por eso
 * `Content-Type: application/octet-stream` y el stream tal cual.
 *
 * ## El alias viaja por cabecera
 *
 * Cuando Gmail reenvía, las cabeceras del original quedan intactas: el `To:`
 * sigue diciendo el correo del cliente y el alias no aparece en el texto. El
 * alias está solo en el sobre —el `RCPT TO` de SMTP—, que es `message.to`. Si
 * el API lo sacara del `To:`, nunca encontraría el tenant.
 *
 * Configuración (`wrangler.toml`):
 *   - binding KV `ALIAS` con una clave por alias vigente
 *   - `API_URL`     — https://<dominio>/api/correo/entrante
 *   - `API_SECRETO` — el mismo valor que `CORREO_SECRETO` en la app
 */

const worker = {
  /**
   * `message.raw` es un stream de una sola lectura, así que hay que juntarlo
   * antes de poder mandarlo: se necesita el largo para la petición y, si algo
   * falla, para poder reintentar.
   */
  async email(message, env, ctx) {
    const alias = String(message.to ?? '').toLowerCase()

    const vigente = await env.ALIAS.get(alias)
    if (!vigente) {
      // Sin persistir y sin alertar. Es tráfico de internet contra un catch-all,
      // no un intento contra un cliente: alertar por cada uno sería apagar la
      // alerta a los dos días.
      return
    }

    const crudo = await new Response(message.raw).arrayBuffer()

    const respuesta = await fetch(env.API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-alias-destino': alias,
        authorization: `Bearer ${env.API_SECRETO}`,
      },
      body: crudo,
    })

    if (!respuesta.ok) {
      // `setReject` le dice al remitente que el correo no se pudo entregar, y
      // Gmail lo reintenta. Es lo correcto cuando el fallo es nuestro: preferimos
      // que el correo vuelva a intentarse a perderlo en silencio, porque un
      // aviso perdido es un pago que nunca se concilia.
      message.setReject(`El API respondió ${respuesta.status}`)
      return
    }

    // El correo ya está guardado del otro lado. `ctx.waitUntil` no hace falta:
    // no queda nada corriendo acá.
    void ctx
  },
}

export default worker
