/**
 * Graba el recorrido completo del producto.
 *
 *   CLAVE_CONSOLA=... pnpm grabar-producto
 *   CLAVE_CONSOLA=... pnpm grabar-producto -- --url http://localhost:3200
 *
 * Por defecto graba **producción**: es lo que se le va a mostrar al cliente, y
 * grabar otra cosa deja la duda de si lo desplegado se ve igual. Sale un `.mp4`
 * con la pantalla y nada más: ni barra de direcciones, ni escritorio.
 *
 * El video **no lleva audio**: Playwright graba imagen. Las grabaciones de las
 * llamadas van aparte, en `public/llamadas/`.
 *
 * Playwright se resuelve desde la skill de navegador de gstack, igual que en
 * `grabar-demo.mts`: no se agrega al proyecto para grabar un video.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

interface Locator {
  click(): Promise<void>
  fill(texto: string): Promise<void>
  first(): Locator
  waitFor(opciones?: { timeout?: number }): Promise<void>
}

interface Page {
  goto(url: string, opciones?: { waitUntil?: 'networkidle' | 'load' }): Promise<unknown>
  locator(selector: string): Locator
  getByLabel(nombre: string): Locator
  getByRole(rol: 'button' | 'link', opciones: { name: RegExp }): Locator
  getByText(texto: string | RegExp): Locator
  setInputFiles(selector: string, archivos: string): Promise<void>
  /**
   * Se le pasa **código como texto**, no una función.
   *
   * `tsx` compila con esbuild y `keepNames`, que envuelve toda función con
   * nombre en un helper `__name`. Al serializar la función para el navegador,
   * el helper no viaja: `ReferenceError: __name is not defined`, y el video
   * queda sin ningún desplazamiento.
   */
  evaluate(codigo: string): Promise<void>
  video(): { path(): Promise<string> } | null
}

interface BrowserContext {
  newPage(): Promise<Page>
  close(): Promise<void>
}

interface Browser {
  newContext(opciones: {
    viewport: { width: number; height: number }
    deviceScaleFactor?: number
    locale?: string
    timezoneId?: string
    recordVideo?: { dir: string; size: { width: number; height: number } }
  }): Promise<BrowserContext>
  close(): Promise<void>
}

const requerir = createRequire(join(homedir(), '.claude/skills/gstack/package.json'))
const { chromium } = requerir('playwright') as {
  chromium: { launch(o?: { args?: string[] }): Promise<Browser> }
}

const ANCHO = 1440
const ALTO = 900

const argumento = (nombre: string, porDefecto: string): string => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : (process.argv[i + 1] ?? porDefecto)
}

const BASE = argumento('url', 'https://cobra-qe1tlyzxa-jesus-pinillas-projects.vercel.app').replace(/\/$/, '')
const CORREO = process.env.CORREO_CONSOLA ?? 'jdpf1803@gmail.com'
const CLAVE = process.env.CLAVE_CONSOLA
const SALIDA = resolve(argumento('salida', 'video'))
const CRUDO = join(SALIDA, '.crudo')

if (!CLAVE) {
  console.error('\n  falta CLAVE_CONSOLA\n')
  process.exit(1)
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Baja despacio hasta el final y vuelve arriba.
 *
 * Un `scrollTo` de golpe no deja leer nada: en un video, lo que no se alcanza a
 * leer es como si no estuviera.
 */
async function recorrer(page: Page, ms = 6000): Promise<void> {
  // Suavizado en los dos extremos: arranca y frena sin tirones.
  await page.evaluate(`(function () {
    var alto = document.body.scrollHeight - window.innerHeight
    if (alto <= 0) return
    var inicio = performance.now()
    ;(function paso() {
      var t = Math.min((performance.now() - inicio) / ${ms}, 1)
      var s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      window.scrollTo(0, alto * s)
      if (t < 1) requestAnimationFrame(paso)
    })()
  })()`)
  await esperar(ms + 800)
}

async function volverArriba(page: Page): Promise<void> {
  await page.evaluate(`window.scrollTo({ top: 0, behavior: 'smooth' })`)
  await esperar(1200)
}

function aMp4(webm: string, mp4: string): void {
  execFileSync(
    'ffmpeg',
    ['-y', '-i', webm, '-vf', 'format=yuv420p', '-c:v', 'libx264',
     '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-r', '30', mp4],
    { stdio: 'pipe' },
  )
}

rmSync(CRUDO, { recursive: true, force: true })
mkdirSync(SALIDA, { recursive: true })

// SwiftShader: sin él, el hero 3D de la landing se graba en blanco.
const browser = await chromium.launch({
  args: ['--force-color-profile=srgb', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const contexto = await browser.newContext({
  viewport: { width: ANCHO, height: ALTO },
  deviceScaleFactor: 2,
  locale: 'es-CO',
  timezoneId: 'America/Bogota',
  recordVideo: { dir: CRUDO, size: { width: ANCHO, height: ALTO } },
})
const page = await contexto.newPage()

console.log(`▸ ${BASE}`)

console.log('  1/7 la landing')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await esperar(5000)
await recorrer(page, 7000)

console.log('  2/7 entrar')
await page.goto(`${BASE}/consola/entrar`, { waitUntil: 'networkidle' })
await esperar(1500)
await page.getByLabel('Correo').fill(CORREO)
await esperar(600)
await page.getByLabel('Contraseña').fill(CLAVE)
await esperar(600)
await page.getByRole('button', { name: /Entrar/ }).click()
await page.getByText(/Cartera/).first().waitFor({ timeout: 30_000 })
await esperar(2500)

console.log('  3/7 cartera')
await recorrer(page, 8000)
await volverArriba(page)

console.log('  4/7 llamadas')
await page.goto(`${BASE}/consola/llamadas`, { waitUntil: 'networkidle' })
await esperar(3000)
await recorrer(page, 5000)
await volverArriba(page)
await page.getByRole('link', { name: /Fernando/ }).first().click()
await page.getByText(/La conversación/).waitFor({ timeout: 30_000 })
await esperar(2500)
await recorrer(page, 11000)

console.log('  5/7 briefing')
await page.goto(`${BASE}/consola/briefing`, { waitUntil: 'load' })
await esperar(2000)
// El briefing lo escribe un modelo y llega en streaming.
await page.getByText(/Lo que hay que arreglar/).waitFor({ timeout: 90_000 })
await esperar(2500)
await recorrer(page, 14000)
await volverArriba(page)

console.log('  6/7 conciliación entre portales')
await page.goto(`${BASE}/consola/conciliacion?modo=portales`, { waitUntil: 'networkidle' })
await esperar(2500)
await page.setInputFiles('#portales-excel', resolve('demo/excel-portales.xlsx'))
await esperar(1200)
await page.getByRole('button', { name: /Conciliar/ }).click()
await page.getByText(/Por dónde empezar/).waitFor({ timeout: 120_000 })
await esperar(2500)
await recorrer(page, 15000)
await volverArriba(page)

console.log('  7/7 consumo')
await page.goto(`${BASE}/consola/consumo`, { waitUntil: 'networkidle' })
await esperar(2500)
await recorrer(page, 8000)
await esperar(2000)

const video = page.video()
await contexto.close()
await browser.close()

const origen = await video?.path()
if (!origen) throw new Error('Playwright no dejó video')

const webm = join(SALIDA, 'ponox-producto.webm')
const mp4 = join(SALIDA, 'ponox-producto.mp4')
renameSync(origen, webm)

console.log('▸ convirtiendo a mp4…')
aMp4(webm, mp4)
rmSync(webm)
rmSync(CRUDO, { recursive: true, force: true })
for (const s of readdirSync(SALIDA).filter((f) => f.endsWith('.webm'))) rmSync(join(SALIDA, s))

const duracion = execFileSync(
  'ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4],
  { encoding: 'utf8' },
).trim()

console.log(`\nListo: ${mp4}  ·  ${Math.round(Number(duracion))}s\n`)
