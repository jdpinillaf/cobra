import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * Qué modelo mueve el cerebro.
 *
 * El agente no depende de un proveedor: las herramientas, las validaciones y el
 * prompt son los mismos. Poder cambiar de proveedor con una variable de entorno
 * también es lo que se le responde al cliente cuando pregunta qué pasa si OpenAI
 * sube precios o cambia condiciones.
 *
 * Si no se declara nada, se elige por la llave que exista. En una demo eso
 * ahorra el paso de acordarse de configurar dos cosas en vez de una.
 */

export type Proveedor = 'openai' | 'anthropic'

const MODELO_POR_DEFECTO: Record<Proveedor, string> = {
  openai: 'gpt-5',
  anthropic: 'claude-sonnet-5',
}

export function proveedorActivo(): Proveedor | null {
  const declarado = process.env.CEREBRO_PROVEEDOR
  if (declarado === 'openai' || declarado === 'anthropic') return declarado

  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  return null
}

/** `null` cuando no hay ninguna llave: el cerebro cae al respaldo guionado. */
export function modeloDelCerebro(): { modelo: LanguageModel; etiqueta: string } | null {
  const proveedor = proveedorActivo()
  if (!proveedor) return null

  const nombre = process.env.CEREBRO_MODELO ?? MODELO_POR_DEFECTO[proveedor]
  const modelo = proveedor === 'openai' ? openai(nombre) : anthropic(nombre)

  return { modelo, etiqueta: `${proveedor}/${nombre}` }
}
