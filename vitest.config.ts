import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Configuración de la suite.
 *
 * Los timeouts no son generosidad: son la diferencia entre una suite honesta y
 * una que miente. Seis archivos levantan PGlite (Postgres en WASM) y compiten
 * por CPU; con el límite de 10 s por defecto, `beforeAll` se pasaba, vitest
 * marcaba esos tests como **skipped**, y el resumen seguía diciendo "633
 * passed". Veintiocho tests de aislamiento entre clientes no corrían y nada lo
 * decía en voz alta.
 *
 * Si algún día la suite se pone lenta de verdad, la respuesta es compartir una
 * sola instancia de PGlite entre archivos, no subir más este número.
 */
export default defineConfig({
  test: {
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // Que un `beforeAll` vencido falle en rojo en vez de saltear en silencio.
    dangerouslyIgnoreUnhandledErrors: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
