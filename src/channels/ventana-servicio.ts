import type { VentanaServicio } from '@/domain/types'
import type { CategoriaFacturable } from './tarifas'

/**
 * Ventana de servicio de 24 h.
 *
 * Es donde vive el ahorro de haber ido a Meta directo: dentro de la ventana los
 * mensajes son gratis y sin tope. Un agente conversacional pasa ahí la mayor
 * parte del tiempo, así que no modelarla es renunciar al motivo económico de la
 * migración y, de paso, mandar texto libre fuera de plazo y comerse un 131047.
 *
 * Deliberadamente separado del guard de la Ley 2300: son dos preguntas
 * distintas y confundirlas es cómo se termina justificando un envío ilegal
 * porque "el deudor había escrito".
 */

export const DURACION_VENTANA_MS = 24 * 60 * 60 * 1000

/** Abre (o renueva) la ventana. Cada entrante del deudor reinicia las 24 h. */
export function abrirVentana(params: {
  clienteId: string
  deudorId: string
  entranteEn: string
}): VentanaServicio {
  const abiertaEn = new Date(params.entranteEn)
  return {
    clienteId: params.clienteId,
    deudorId: params.deudorId,
    abiertaEn: abiertaEn.toISOString(),
    expiraEn: new Date(abiertaEn.getTime() + DURACION_VENTANA_MS).toISOString(),
  }
}

export function estaAbierta(ventana: VentanaServicio | null, ahora: Date): boolean {
  if (!ventana) return false
  return ahora.getTime() < new Date(ventana.expiraEn).getTime()
}

/**
 * Fuera de la ventana, WhatsApp solo acepta plantillas aprobadas: el texto
 * libre se rechaza con el error 131047.
 */
export function requierePlantilla(ventana: VentanaServicio | null, ahora: Date): boolean {
  return !estaAbierta(ventana, ahora)
}

/**
 * Categoría con la que hay que facturar un mensaje saliente.
 *
 * Dentro de la ventana y sin plantilla es `servicio`, que vale cero. Una
 * plantilla se cobra por su categoría **aunque** la ventana esté abierta: Meta
 * cobra las plantillas siempre, y una `marketing` cuesta lo mismo adentro que
 * afuera.
 */
export function categoriaDelEnvio(params: {
  ventana: VentanaServicio | null
  ahora: Date
  categoriaDePlantilla: CategoriaFacturable | null
}): CategoriaFacturable {
  if (params.categoriaDePlantilla && params.categoriaDePlantilla !== 'servicio') {
    return params.categoriaDePlantilla
  }
  return estaAbierta(params.ventana, params.ahora) ? 'servicio' : 'utility'
}
