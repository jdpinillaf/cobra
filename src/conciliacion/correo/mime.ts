/**
 * De los bytes del correo a un texto que se pueda parsear.
 *
 * Deliberadamente sin librería, igual que el canal de WhatsApp y el hash de
 * contraseñas: lo que hace falta de MIME acá es un subconjunto chico y cerrado
 * —cabeceras, un cuerpo, dos codificaciones— y una dependencia que parsea todo
 * el estándar trae superficie que nadie va a usar.
 *
 * **El crudo no se toca.** `parsearMime` lee, no reescribe: DKIM se calcula
 * sobre los bytes exactos que llegaron y cualquier normalización rompe el hash
 * del cuerpo, así que lo que se guarda en `raw_emails.crudo` y lo que se le
 * pasa al verificador es siempre el original.
 *
 * Tres cosas que el correo real trae y el ejemplo de manual no:
 *
 * - **`quoted-printable`.** Bancolombia manda acentos, y sin decodificar
 *   "transferencia de JOSÉ" llega como "JOS=C3=89" y ningún patrón matchea.
 * - **`multipart/alternative`.** El texto plano y el HTML vienen los dos. Se usa
 *   el plano; el HTML es decoración y lo van a rediseñar.
 * - **Cabeceras plegadas.** Una cabecera larga se parte en varias líneas con
 *   sangría, y leerla línea a línea deja `d=` de la firma DKIM en un renglón
 *   que no empieza con `DKIM-Signature`.
 */

export interface CorreoMime {
  /** Nombre en minúscula → todos sus valores. `Received` aparece varias veces. */
  cabeceras: Record<string, string[]>
  messageId: string | null
  /** Solo la dirección, sin el nombre para mostrar. */
  de: string | null
  para: string | null
  asunto: string | null
  /** El cuerpo ya en texto plano: sin multipart, sin HTML y decodificado. */
  texto: string
}

/** Separa cabeceras de cuerpo en la primera línea en blanco. */
function partir(crudo: string): { cabeceras: string; cuerpo: string } {
  const corte = crudo.search(/\r?\n\r?\n/)
  if (corte === -1) return { cabeceras: crudo, cuerpo: '' }

  const finLinea = /\r?\n\r?\n/.exec(crudo.slice(corte))![0].length
  return { cabeceras: crudo.slice(0, corte), cuerpo: crudo.slice(corte + finLinea) }
}

/**
 * Despliega las cabeceras y las agrupa por nombre.
 *
 * El plegado de RFC 5322: una línea que empieza con espacio o tab es la
 * continuación de la anterior. Sin esto, una firma DKIM larga —que siempre lo
 * es— queda partida y el `d=` cae en una línea suelta que no se atribuye a
 * ninguna cabecera.
 */
function leerCabeceras(bloque: string): Record<string, string[]> {
  const cabeceras: Record<string, string[]> = {}
  const lineas = bloque.split(/\r?\n/)
  const desplegadas: string[] = []

  for (const linea of lineas) {
    if (/^[ \t]/.test(linea) && desplegadas.length > 0) {
      desplegadas[desplegadas.length - 1] += ' ' + linea.trim()
      continue
    }
    desplegadas.push(linea)
  }

  for (const linea of desplegadas) {
    const corte = linea.indexOf(':')
    if (corte <= 0) continue
    const nombre = linea.slice(0, corte).trim().toLowerCase()
    const valor = linea.slice(corte + 1).trim()
    ;(cabeceras[nombre] ??= []).push(valor)
  }

  return cabeceras
}

/** `Bancolombia <alertas@banco.com>` → `alertas@banco.com`. */
export function direccionDe(valor: string | null | undefined): string | null {
  if (!valor) return null
  const entreAngulos = /<([^>]+)>/.exec(valor)
  const crudo = (entreAngulos ? entreAngulos[1] : valor).trim()
  return crudo.includes('@') ? crudo.toLowerCase() : null
}

/**
 * Decodifica `quoted-printable`.
 *
 * Dos reglas: `=XX` es un byte en hexadecimal, y un `=` al final de línea es un
 * corte blando que se borra junto con el salto. Los bytes se juntan y recién al
 * final se interpretan como UTF-8, porque un carácter acentuado son dos bytes y
 * decodificar de a uno partiría la letra por la mitad.
 */
function decodificarQuotedPrintable(texto: string): string {
  const sinCortes = texto.replace(/=\r?\n/g, '')
  const bytes: number[] = []

  for (let i = 0; i < sinCortes.length; i += 1) {
    if (sinCortes[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(sinCortes.slice(i + 1, i + 3))) {
      bytes.push(parseInt(sinCortes.slice(i + 1, i + 3), 16))
      i += 2
      continue
    }
    // El resto del quoted-printable es ASCII imprimible por definición.
    bytes.push(sinCortes.charCodeAt(i) & 0xff)
  }

  return Buffer.from(bytes).toString('utf8')
}

function decodificarCuerpo(cuerpo: string, codificacion: string | null): string {
  const modo = (codificacion ?? '').toLowerCase().trim()
  if (modo === 'quoted-printable') return decodificarQuotedPrintable(cuerpo)
  if (modo === 'base64') return Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64').toString('utf8')
  return cuerpo
}

/**
 * HTML a texto, lo justo para que los patrones del parser encuentren la frase.
 *
 * No pretende ser un renderizador. `<br>` y `</p>` pasan a salto de línea
 * porque separan datos que si no quedan pegados, y las entidades que aparecen
 * en un correo de banco son cuatro.
 */
function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function valorDeParametro(cabecera: string | null, parametro: string): string | null {
  if (!cabecera) return null
  const patron = new RegExp(`${parametro}\\s*=\\s*"?([^";]+)"?`, 'i')
  return patron.exec(cabecera)?.[1]?.trim() ?? null
}

/**
 * El texto plano de un cuerpo que puede ser multipart.
 *
 * Recursivo porque `multipart/mixed` puede envolver un `multipart/alternative`:
 * el correo con logo adjunto y dos versiones del mensaje adentro es la forma
 * normal de un aviso bancario, no un caso raro.
 *
 * Prefiere `text/plain` sobre `text/html` siempre. Si solo hay HTML, lo aplana.
 */
function textoDe(cuerpo: string, contentType: string | null, codificacion: string | null): string {
  const tipo = (contentType ?? 'text/plain').toLowerCase()

  if (!tipo.startsWith('multipart/')) {
    const plano = decodificarCuerpo(cuerpo, codificacion)
    return tipo.includes('text/html') ? htmlATexto(plano) : plano
  }

  const frontera = valorDeParametro(contentType, 'boundary')
  if (!frontera) return decodificarCuerpo(cuerpo, codificacion)

  const partes = cuerpo
    .split(new RegExp(`\r?\n?--${frontera.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?\r?\n?`))
    .filter((p) => p && p.trim() !== '' && p !== '--')

  const textos: Array<{ esPlano: boolean; texto: string }> = []
  for (const parte of partes) {
    const { cabeceras: bloque, cuerpo: cuerpoParte } = partir(parte)
    const c = leerCabeceras(bloque)
    const tipoParte = c['content-type']?.[0] ?? null
    // Sin cabeceras propias no es una parte MIME: es el preámbulo que va antes
    // de la primera frontera, y los clientes lo ignoran.
    if (!tipoParte) continue

    const texto = textoDe(cuerpoParte, tipoParte, c['content-transfer-encoding']?.[0] ?? null)
    if (texto.trim() === '') continue
    textos.push({ esPlano: tipoParte.toLowerCase().includes('text/plain'), texto })
  }

  return (textos.find((t) => t.esPlano) ?? textos[0])?.texto ?? ''
}

export function parsearMime(crudo: string): CorreoMime {
  const { cabeceras: bloque, cuerpo } = partir(crudo)
  const cabeceras = leerCabeceras(bloque)
  const primera = (nombre: string) => cabeceras[nombre]?.[0] ?? null

  return {
    cabeceras,
    // Los ángulos son parte del formato del Message-ID, no de su valor.
    messageId: primera('message-id')?.replace(/^<|>$/g, '') ?? null,
    de: direccionDe(primera('from')),
    para: direccionDe(primera('to')),
    asunto: primera('subject'),
    texto: textoDe(cuerpo, primera('content-type'), primera('content-transfer-encoding')),
  }
}

/**
 * Los dominios que dicen firmar el correo.
 *
 * **Esto no verifica nada**: lee el `d=` que el propio correo declara, y
 * cualquiera puede escribir el que quiera. Sirve para saber contra qué clave
 * habría que validar y para el doble de pruebas. La verificación de verdad es
 * criptográfica y vive en `verificador.ts`.
 *
 * Un correo puede traer varias firmas —el remitente y cada reenviador— y son
 * todas legítimas. Lo que importa es que **alguna** sea la del banco y sea
 * válida.
 */
export function dominiosDkimDeclarados(correo: CorreoMime): string[] {
  return (correo.cabeceras['dkim-signature'] ?? [])
    .map((firma) => /(?:^|;)\s*d\s*=\s*([^;\s]+)/i.exec(firma)?.[1]?.toLowerCase() ?? null)
    .filter((d): d is string => d !== null)
}

/**
 * La cadena de reenvío, del salto más reciente al más viejo.
 *
 * Es la tercera defensa del §5 del plan: el correo tiene que mostrar el salto
 * desde el Gmail registrado del cliente. Un correo inyectado directo al alias
 * no lo tiene.
 */
export function cadenaDeReenvio(correo: CorreoMime): string[] {
  return correo.cabeceras['received'] ?? []
}
