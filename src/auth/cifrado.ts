import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Secretos de terceros, cifrados en reposo.
 *
 * El caso que lo motiva es el token de System User de WhatsApp: es del Business
 * Manager **del cliente**, vive en `tenants.wa_token_cifrado` y con él se puede
 * mandar mensajes en su nombre hasta que él lo revoque. Un `pg_dump`, una
 * captura de la consola de Supabase o un backup mal guardado no pueden
 * entregarlo en texto plano.
 *
 * Vive al lado de `clave.ts` porque son las dos primitivas de `node:crypto` del
 * repo y comparten las mismas dos reglas: sin librería, y el formato guardado
 * se describe a sí mismo. Pero resuelven cosas distintas y no hay que
 * confundirlas — una contraseña se **hashea** y no se recupera nunca; esto se
 * **cifra** y hay que poder recuperarlo, porque Meta necesita el token literal.
 *
 * **AES-256-GCM y no CBC.** GCM autentica: si alguien edita un byte del texto
 * cifrado en la base, el descifrado lanza en vez de devolver basura. Con CBC un
 * token corrompido saldría como una cadena cualquiera y se mandaría a Meta,
 * que respondería 401 sin decir por qué.
 *
 * **IV aleatorio por cifrado.** Reusar el IV con GCM no filtra "solo un poco":
 * rompe la autenticación del esquema entero y permite falsificar mensajes.
 */

const ALGORITMO = 'aes-256-gcm'
const LARGO_IV = 12 // 96 bits, el tamaño que GCM espera
const LARGO_CLAVE = 32
const ETIQUETA = 'gcm1'

/**
 * La clave de cifrado, derivada del secreto del entorno.
 *
 * `SECRETO_CREDENCIALES` es una frase, no 32 bytes exactos, así que se pasa por
 * scrypt para llegar al largo que AES-256 necesita. La sal es fija a propósito:
 * una aleatoria daría una clave distinta en cada arranque y no se podría
 * descifrar nada de lo guardado ayer. Lo que aporta entropía acá es el secreto,
 * no la sal.
 *
 * Se deriva en cada llamada y no en un módulo cacheado porque el entorno puede
 * no estar cargado cuando se importa el módulo, y un secreto leído a destiempo
 * deja la app cifrando con una clave derivada de `undefined`.
 */
function claveDe(secreto: string): Buffer {
  if (secreto.length < 16) {
    throw new Error('SECRETO_CREDENCIALES es demasiado corto: mínimo 16 caracteres')
  }
  return scryptSync(secreto, 'ponox/credenciales', LARGO_CLAVE)
}

function secretoDelEntorno(): string {
  const secreto = process.env.SECRETO_CREDENCIALES
  if (!secreto) {
    // Ruidoso a propósito. Sin secreto la alternativa sería guardar el token en
    // claro, y eso no puede pasar por un olvido de configuración.
    throw new Error('Falta SECRETO_CREDENCIALES: no se puede cifrar ni descifrar nada.')
  }
  return secreto
}

/** Devuelve `gcm1$<iv>$<tag>$<cifrado>`, todo en base64url. */
export function cifrar(texto: string, secreto = secretoDelEntorno()): string {
  const iv = randomBytes(LARGO_IV)
  const cifrador = createCipheriv(ALGORITMO, claveDe(secreto), iv)
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])

  return [
    ETIQUETA,
    iv.toString('base64url'),
    cifrador.getAuthTag().toString('base64url'),
    cuerpo.toString('base64url'),
  ].join('$')
}

/**
 * Lanza ante cualquier problema: formato raro, clave equivocada o texto
 * manipulado.
 *
 * Al revés que `verificarClave`, que devuelve `false` y nunca lanza. La
 * diferencia es qué significa el fallo. Ahí, "no pude" es una respuesta válida
 * —la clave estaba mal—; acá significa que un secreto que la app cree tener no
 * se puede usar, y seguir adelante mandaría a Meta un token vacío o corrupto.
 */
export function descifrar(guardado: string, secreto = secretoDelEntorno()): string {
  const partes = guardado.split('$')
  if (partes.length !== 4 || partes[0] !== ETIQUETA) {
    throw new Error('Credencial cifrada con un formato que no se reconoce.')
  }

  const [, ivB64, tagB64, cuerpoB64] = partes
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== LARGO_IV || tag.length !== 16) {
    throw new Error('Credencial cifrada con un IV o una etiqueta de largo inválido.')
  }

  const descifrador = createDecipheriv(ALGORITMO, claveDe(secreto), iv)
  descifrador.setAuthTag(tag)
  return Buffer.concat([
    descifrador.update(Buffer.from(cuerpoB64, 'base64url')),
    descifrador.final(),
  ]).toString('utf8')
}

/**
 * ¿Esto ya está cifrado?
 *
 * Sirve durante la migración de un valor que hoy puede estar en claro en una
 * fila vieja. Mirar el prefijo es suficiente y no toca la clave: preguntarlo
 * intentando descifrar costaría un scrypt por fila.
 */
export function estaCifrado(valor: string): boolean {
  return valor.startsWith(`${ETIQUETA}$`)
}
