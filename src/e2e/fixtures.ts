/**
 * Constructores de las dos entradas del sistema.
 *
 * El correo se arma como MIME de verdad, no como un objeto, porque la
 * autenticidad se juega en las cabeceras y un fixture que las esconda probaría
 * el parser contra una fantasía. Las dos plantillas son las dos que se vieron
 * en correos reales de Bancolombia, con sus diferencias de formato intactas:
 * orden de remitente y monto, centavos o no, uno o dos asteriscos, año de dos
 * o cuatro dígitos, y la coma antes de "el".
 */

export interface DatosCorreo {
  plantilla: 'llaves' | 'transferencia'
  montoTexto: string
  remitente: string
  cuentaUltimos4: string
  /** `DD/MM/AA` o `DD/MM/AAAA` según la plantilla. */
  fecha: string
  hora: string
  alias: string
  /** Cómo se comporta la firma. `otroDominio` es el ataque del §5 del plan. */
  dkim?: 'valido' | 'invalido' | 'otroDominio' | 'ausente'
  de?: string
}

const CUERPOS = {
  llaves: (d: DatosCorreo) =>
    `Hola Adriana, recibiste una transferencia de ${d.remitente} por $${d.montoTexto} en tu cuenta *${d.cuentaUltimos4} el ${d.fecha} a las ${d.hora}.`,
  transferencia: (d: DatosCorreo) =>
    `Hola, recibiste una transferencia por $${d.montoTexto} de ${d.remitente} en tu cuenta **${d.cuentaUltimos4}, el ${d.fecha} a las ${d.hora}.`,
}

export function correoBancolombia(d: DatosCorreo): string {
  const dkim = d.dkim ?? 'valido'
  const de = d.de ?? 'alertasynotificaciones@an.notificacionesbancolombia.com'
  const dominioFirma =
    dkim === 'otroDominio' ? 'atacante-que-parece-banco.com' : 'notificacionesbancolombia.com'

  const cabeceras = [
    `Message-ID: <${d.fecha}-${d.hora}-${d.montoTexto}@bancolombia>`,
    `From: Bancolombia <${de}>`,
    `To: ${d.alias}`,
    `Subject: Notificacion de transaccion`,
    `Date: ${d.fecha} ${d.hora}`,
    `Received: from mail-gmail.google.com by mx.cloudflare.net; ${d.fecha}`,
    `Content-Type: text/plain; charset=utf-8`,
  ]
  if (dkim !== 'ausente') {
    cabeceras.push(
      `DKIM-Signature: v=1; a=rsa-sha256; d=${dominioFirma}; s=selector; bh=${dkim === 'invalido' ? 'ROTA' : 'ok'}; b=firma`,
    )
  }
  return cabeceras.join('\r\n') + '\r\n\r\n' + CUERPOS[d.plantilla](d)
}

export interface DatosCaptura {
  montoCentavos: number | null
  remitente: string | null
  /** ISO en America/Bogota. `null` simula un recorte sin fecha visible. */
  ocurridoEn: string | null
  banco?: 'bancolombia' | 'nequi' | 'daviplata'
  destinoUltimos4?: string | null
}

/**
 * Una "imagen" es el JSON que el OCR de prueba va a devolver.
 *
 * Así el E2E ejercita el camino completo sin gastar una llamada al modelo, y
 * puede fabricar el caso que importa — el recorte sin fecha, el ilegible — que
 * con imágenes reales dependería de tener la captura justa a mano.
 */
export function captura(d: DatosCaptura): string {
  return JSON.stringify({ banco: 'bancolombia', destinoUltimos4: null, ...d })
}

/** Una imagen que el OCR no puede leer: todos los campos en null. */
export const capturaIlegible = captura({
  montoCentavos: null,
  remitente: null,
  ocurridoEn: null,
})
