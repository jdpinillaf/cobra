import { describe, expect, it } from 'vitest'
import {
  cadenaDeReenvio,
  direccionDe,
  dominiosDkimDeclarados,
  parsearMime,
} from './mime'
import { correoBancolombia } from '@/e2e/fixtures'

/**
 * Lo que se prueba acá no es MIME: es lo que el correo real trae y el ejemplo
 * de manual no. Un parser que solo aguanta el fixture pasa la suite y falla el
 * primer día contra Bancolombia.
 */

const crlf = (...lineas: string[]) => lineas.join('\r\n')

describe('parsearMime', () => {
  it('lee las cabeceras y el cuerpo del fixture', () => {
    const correo = parsearMime(
      correoBancolombia({
        plantilla: 'llaves',
        montoTexto: '100,000.00',
        remitente: 'CARLOS RAMIREZ GOMEZ',
        cuentaUltimos4: '4129',
        fecha: '14/08/26',
        hora: '15:32',
        alias: 'k7f2mq9xz3@in.ponox.co',
      }),
    )

    expect(correo.de).toBe('alertasynotificaciones@an.notificacionesbancolombia.com')
    expect(correo.para).toBe('k7f2mq9xz3@in.ponox.co')
    expect(correo.messageId).not.toBeNull()
    expect(correo.texto).toContain('recibiste una transferencia')
  })

  it('quita los ángulos del Message-ID', () => {
    const correo = parsearMime(crlf('Message-ID: <abc@banco>', 'From: a@b.com', '', 'hola'))
    expect(correo.messageId).toBe('abc@banco')
  })

  it('conserva todas las cabeceras repetidas', () => {
    const correo = parsearMime(
      crlf('Received: de gmail', 'Received: de cloudflare', 'From: a@b.com', '', 'hola'),
    )
    expect(cadenaDeReenvio(correo)).toEqual(['de gmail', 'de cloudflare'])
  })

  it('despliega una cabecera plegada en varias líneas', () => {
    // El caso real: una firma DKIM siempre viene partida, y leer línea a línea
    // deja el `d=` en un renglón que no se atribuye a ninguna cabecera.
    const correo = parsearMime(
      crlf(
        'DKIM-Signature: v=1; a=rsa-sha256;',
        '\td=notificacionesbancolombia.com; s=sel;',
        ' bh=abc; b=firma',
        'From: a@b.com',
        '',
        'hola',
      ),
    )

    expect(dominiosDkimDeclarados(correo)).toEqual(['notificacionesbancolombia.com'])
  })

  it('lee todas las firmas cuando el correo pasó por varios saltos', () => {
    const correo = parsearMime(
      crlf(
        'DKIM-Signature: v=1; d=notificacionesbancolombia.com; b=x',
        'DKIM-Signature: v=1; d=gmail.com; b=y',
        'From: a@b.com',
        '',
        'hola',
      ),
    )
    expect(dominiosDkimDeclarados(correo)).toEqual([
      'notificacionesbancolombia.com',
      'gmail.com',
    ])
  })

  it('decodifica quoted-printable, acentos incluidos', () => {
    // Sin esto "transferencia de JOSÉ" llega como "JOS=C3=89" y ningún patrón
    // del parser encuentra el nombre.
    const correo = parsearMime(
      crlf(
        'From: a@b.com',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'recibiste una transferencia de JOS=C3=89 PE=C3=91A por $100,000.00',
      ),
    )

    expect(correo.texto).toContain('JOSÉ PEÑA')
  })

  it('respeta el corte blando de quoted-printable', () => {
    const correo = parsearMime(
      crlf(
        'From: a@b.com',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'recibiste una trans=',
        'ferencia por $600,000',
      ),
    )
    expect(correo.texto).toContain('recibiste una transferencia por $600,000')
  })

  it('decodifica base64', () => {
    const cuerpo = Buffer.from('recibiste una transferencia de ANA', 'utf8').toString('base64')
    const correo = parsearMime(
      crlf('From: a@b.com', 'Content-Transfer-Encoding: base64', '', cuerpo),
    )
    expect(correo.texto).toContain('recibiste una transferencia de ANA')
  })

  it('prefiere el texto plano sobre el HTML en un multipart', () => {
    // El HTML es decoración y Bancolombia lo va a rediseñar. La frase es el
    // payload y viaja en la parte plana.
    const correo = parsearMime(
      crlf(
        'From: a@b.com',
        'Content-Type: multipart/alternative; boundary="frontera"',
        '',
        '--frontera',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'la version en texto',
        '--frontera',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>la version en <b>html</b></p>',
        '--frontera--',
      ),
    )

    expect(correo.texto.trim()).toBe('la version en texto')
  })

  it('aplana el HTML cuando es lo único que hay', () => {
    const correo = parsearMime(
      crlf(
        'From: a@b.com',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>recibiste una transferencia<br>de <b>ANA</b> por $600,000</p>',
      ),
    )

    expect(correo.texto).toContain('recibiste una transferencia')
    expect(correo.texto).toContain('ANA')
    expect(correo.texto).not.toContain('<b>')
  })

  it('entra a un multipart anidado', () => {
    // `multipart/mixed` con el logo adjunto envolviendo al `alternative` es la
    // forma normal de un aviso bancario, no un caso raro.
    const correo = parsearMime(
      crlf(
        'From: a@b.com',
        'Content-Type: multipart/mixed; boundary="afuera"',
        '',
        '--afuera',
        'Content-Type: multipart/alternative; boundary="adentro"',
        '',
        '--adentro',
        'Content-Type: text/plain',
        '',
        'la frase que importa',
        '--adentro--',
        '--afuera',
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgo=',
        '--afuera--',
      ),
    )

    expect(correo.texto.trim()).toBe('la frase que importa')
  })

  it('no se cae con un correo sin cuerpo', () => {
    const correo = parsearMime('From: a@b.com\r\nSubject: vacio')
    expect(correo.texto).toBe('')
    expect(correo.asunto).toBe('vacio')
  })

  it('no inventa firmas cuando no hay ninguna', () => {
    expect(dominiosDkimDeclarados(parsearMime('From: a@b.com\r\n\r\nhola'))).toEqual([])
  })
})

describe('direccionDe', () => {
  it.each([
    ['Bancolombia <alertas@banco.com>', 'alertas@banco.com'],
    ['alertas@banco.com', 'alertas@banco.com'],
    ['  ALERTAS@Banco.COM  ', 'alertas@banco.com'],
    ['"Apellido, Nombre" <a@b.co>', 'a@b.co'],
  ])('%s → %s', (crudo, esperado) => {
    expect(direccionDe(crudo)).toBe(esperado)
  })

  it('devuelve null ante lo que no es una dirección', () => {
    expect(direccionDe('Bancolombia')).toBeNull()
    expect(direccionDe(null)).toBeNull()
  })
})
