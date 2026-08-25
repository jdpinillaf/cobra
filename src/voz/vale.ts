/**
 * El vale que autoriza una sesión de voz.
 *
 * El WebSocket que Twilio abre está expuesto a internet por el túnel y **no
 * lleva firma de Twilio**: cualquiera que descubra la URL podría abrir una
 * sesión contra la cartera de un cliente y ponerse a negociar acuerdos. El vale
 * cierra eso.
 *
 * Es un token firmado y no un id de tabla porque el servidor de voz corre en
 * otro proceso: validar sin ir a la base lo mantiene sin estado y sin
 * dependencia de arranque.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface DatosLlamada {
  tenantId: string
  conversacionId: string
  obligacionId: string
  deudorId: string
  telefono: string
}

interface Cuerpo extends DatosLlamada {
  expiraEn: number
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const deB64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

const firmar = (carga: string, secreto: string): string =>
  createHmac('sha256', secreto).update(carga).digest('base64url')

/** Vida corta: el vale se emite al marcar y se usa cuando la llamada conecta. */
export const VIDA_SEGUNDOS = 300

export function firmarVale(
  datos: DatosLlamada,
  secreto: string,
  ahoraMs: number = Date.now(),
): string {
  const cuerpo: Cuerpo = { ...datos, expiraEn: ahoraMs + VIDA_SEGUNDOS * 1000 }
  const carga = b64(JSON.stringify(cuerpo))
  return `${carga}.${firmar(carga, secreto)}`
}

/**
 * Devuelve los datos solo si la firma cuadra y el vale no venció.
 *
 * La comparación es en tiempo constante: con `===`, alguien que pruebe firmas
 * puede medir cuánto prefijo acertó y construir una válida byte por byte.
 */
export function abrirVale(
  vale: string,
  secreto: string,
  ahoraMs: number = Date.now(),
): DatosLlamada | null {
  const punto = vale.lastIndexOf('.')
  if (punto <= 0) return null

  const carga = vale.slice(0, punto)
  const recibida = Buffer.from(vale.slice(punto + 1))
  const esperada = Buffer.from(firmar(carga, secreto))
  if (esperada.length !== recibida.length) return null
  if (!timingSafeEqual(esperada, recibida)) return null

  let cuerpo: Cuerpo
  try {
    cuerpo = JSON.parse(deB64(carga)) as Cuerpo
  } catch {
    return null
  }
  if (typeof cuerpo.expiraEn !== 'number' || cuerpo.expiraEn < ahoraMs) return null

  return {
    tenantId: cuerpo.tenantId,
    conversacionId: cuerpo.conversacionId,
    obligacionId: cuerpo.obligacionId,
    deudorId: cuerpo.deudorId,
    telefono: cuerpo.telefono,
  }
}
