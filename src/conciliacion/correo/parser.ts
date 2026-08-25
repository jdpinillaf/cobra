import { desdeBogota } from '@/compliance/reloj-bogota'
import { parseMonto } from './monto'

/**
 * De la frase del banco a un aviso estructurado.
 *
 * Se trabaja sobre **texto plano**, no sobre el DOM: el HTML es decoración y
 * Bancolombia lo va a rediseñar; la frase es el payload y sobrevive al
 * rediseño.
 *
 * Los patrones se componen de fragmentos en vez de escribirse enteros. Hoy son
 * dos plantillas y ya repiten cuatro trozos idénticos; van a ser seis o siete
 * cuando entren Nequi, QR, consignación en efectivo y PSE, y a esa altura una
 * lista de expresiones completas es donde se cuela la que quedó distinta.
 *
 * **Lo que no matchea no se descarta.** `parsearAviso` devuelve `null` y quien
 * llama guarda el crudo y dispara la alerta: el día que el banco cambie la
 * redacción se sabe ese mismo día, no tres semanas después con clientes
 * furiosos. Es el mismo argumento del riesgo de banco único — si se cae el
 * parser, se caen todos los clientes a la vez y no hay diversificación que
 * amortigüe.
 */

/** Admite "JOSE A. GOMEZ", "PEÑA-LOPEZ", "D'ANGELO". No greedy: para en la palabra clave. */
const NOMBRE = String.raw`[\p{L}\p{M}.'\- ]+?`
const MONTO = String.raw`[\d.,]+`
/** Una o dos estrellas según la plantilla, y los cuatro dígitos que importan. */
const CUENTA = String.raw`\*+(?<cuenta>\d{4})`
/** `14/08/26` o `14/08/2026`: el año viene de dos o de cuatro dígitos. */
const FECHA = String.raw`(?<fecha>\d{1,2}\/\d{1,2}\/\d{2,4})`
const HORA = String.raw`(?<hora>\d{1,2}:\d{2})`

interface Plantilla {
  nombre: string
  patron: RegExp
}

const PLANTILLAS: Plantilla[] = [
  {
    // Llaves: el remitente va antes del monto, y el monto siempre trae centavos.
    nombre: 'llaves',
    patron: new RegExp(
      String.raw`recibiste una transferencia de (?<remitente>${NOMBRE}) por \$(?<monto>${MONTO}) en tu cuenta ${CUENTA}.*?el ${FECHA} a las ${HORA}`,
      'iu',
    ),
  },
  {
    // Transferencia: el monto va antes del remitente, y hay una coma antes de "el".
    nombre: 'transferencia',
    patron: new RegExp(
      String.raw`recibiste una transferencia por \$(?<monto>${MONTO}) de (?<remitente>${NOMBRE}) en tu cuenta ${CUENTA},? el ${FECHA} a las ${HORA}`,
      'iu',
    ),
  },
]

export interface AvisoBancario {
  /** Qué plantilla matcheó. Queda en la traza: sirve para ver cuál dejó de matchear. */
  plantilla: string
  montoCentavos: number
  /** El nombre tal como lo escribió el banco. Se guarda sin tocar. */
  remitenteRaw: string
  /** Mayúsculas sin tildes, para comparar por tokens contra el comprobante. */
  remitenteNorm: string
  cuentaUltimos4: string
  /** Instante real, resuelto en hora de Bogotá. */
  ocurridoEn: Date
}

/**
 * Normaliza un nombre para poder compararlo.
 *
 * "ADRIANA PINILLA FERNANDEZ" en el correo puede venir como "Adriana Pinilla"
 * en el comprobante, así que la comparación es por tokens y no por cadena
 * completa. Acá solo se prepara el terreno: mayúsculas, sin tildes y sin
 * puntuación.
 */
export function normalizarNombre(nombre: string): string {
  return (
    nombre
      // NFD separa la letra de su tilde, y el rango de abajo son los signos
      // combinantes: así "PEÑA" queda "PENA" y cruza contra un comprobante que
      // lo escribió sin eñe, que es lo que hace la mitad de las apps.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * `14/08/26` y `15:32` al instante que representan.
 *
 * El correo no dice zona horaria. Interpretarlo en la del servidor —que corre
 * en UTC— lo correría cinco horas, y cinco horas contra una ventana de quince
 * minutos significa que no cruza nunca.
 *
 * El año de dos dígitos se resuelve al 2000: un aviso bancario de 1926 no
 * existe, y para cuando el siglo importe este código ya no.
 */
export function instanteDelAviso(fecha: string, hora: string): Date {
  const [dia, mes, anioCrudo] = fecha.split('/').map(Number)
  const [hh, mm] = hora.split(':').map(Number)

  if ([dia, mes, anioCrudo, hh, mm].some((n) => !Number.isFinite(n))) {
    throw new Error(`Fecha u hora ilegibles: ${fecha} ${hora}`)
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23 || mm > 59) {
    throw new Error(`Fecha u hora fuera de rango: ${fecha} ${hora}`)
  }

  const anio = anioCrudo < 100 ? 2000 + anioCrudo : anioCrudo
  const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  const instante = desdeBogota(iso, hh, mm)

  if (Number.isNaN(instante.getTime())) {
    throw new Error(`Fecha imposible: ${fecha} ${hora}`)
  }
  return instante
}

/**
 * Devuelve `null` si ninguna plantilla matcheó, y **lanza** si matcheó pero el
 * contenido no se puede leer.
 *
 * La diferencia importa aguas arriba: `null` es "esto no es un aviso de ingreso
 * que conozcamos" —puede ser un correo de seguridad, una promoción— y va a
 * cuarentena sin ruido. Una excepción es "esto se parece a un aviso y no lo
 * pude leer", que es exactamente lo que tiene que despertar a alguien.
 */
export function parsearAviso(texto: string): AvisoBancario | null {
  // El correo llega con saltos de línea en cualquier lado: el HTML aplanado los
  // mete donde el cliente decidió cortar la caja. Los patrones asumen una sola
  // línea porque la frase es una sola oración.
  const enUnaLinea = texto.replace(/\s+/g, ' ').trim()

  for (const { nombre, patron } of PLANTILLAS) {
    const encontrado = patron.exec(enUnaLinea)
    if (!encontrado?.groups) continue

    const { remitente, monto, cuenta, fecha, hora } = encontrado.groups
    const remitenteRaw = remitente.trim()

    return {
      plantilla: nombre,
      montoCentavos: parseMonto(monto),
      remitenteRaw,
      remitenteNorm: normalizarNombre(remitenteRaw),
      cuentaUltimos4: cuenta,
      ocurridoEn: instanteDelAviso(fecha, hora),
    }
  }

  return null
}

/**
 * La huella de un aviso.
 *
 * El correo **no trae identificador de transacción**: ni CUS, ni referencia, ni
 * nada. Así que la identidad hay que fabricarla con lo que sí trae, y eso
 * colisiona cuando dos personas pagan lo mismo en el mismo minuto a la misma
 * cuenta.
 *
 * Esa colisión es real y no se descarta: por eso el índice de `huella` **no es
 * único** y dos avisos con la misma huella van los dos a revisión. Perder el
 * segundo en silencio sería perder un pago que existió.
 */
export function huellaDelAviso(aviso: AvisoBancario): string {
  return [
    aviso.montoCentavos,
    aviso.remitenteNorm,
    aviso.ocurridoEn.toISOString(),
    aviso.cuentaUltimos4,
  ].join('|')
}
