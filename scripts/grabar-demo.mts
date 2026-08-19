/**
 * Graba el video de la demo.
 *
 *   pnpm grabar            # servidor en :3100, salida en video/
 *   pnpm grabar -- --url http://localhost:3000
 *
 * Abre el navegador sin cabeza, escribe como escribiría el deudor, paga en una
 * pestaña aparte y deja que la confirmación llegue sola al teléfono. Sale un
 * `.mp4` con la página y nada más: ni barra de direcciones, ni cursor del
 * sistema, ni ventanas de fondo.
 *
 * Playwright vive en las dependencias de la skill de navegador de gstack; no se
 * agrega al proyecto solo para grabar un video una vez.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Playwright no es dependencia del proyecto: se resuelve desde la skill de
 * navegador de gstack, que ya lo trae con su Chromium. Agregarlo al
 * `package.json` metería ~300 MB al `pnpm install` de todo el mundo para grabar
 * un video de vez en cuando.
 *
 * Como no está instalado acá, `tsc` no puede leer sus tipos. En vez de excluir
 * este archivo del typecheck —que lo dejaría sin red— se declara la superficie
 * que se usa, que son ocho métodos.
 */
interface Locator {
  click(): Promise<void>
  count(): Promise<number>
  nth(i: number): Locator
  first(): Locator
  pressSequentially(texto: string, opciones?: { delay?: number }): Promise<void>
  waitFor(opciones?: { timeout?: number }): Promise<void>
}

interface Page {
  goto(url: string, opciones?: { waitUntil?: 'networkidle' }): Promise<unknown>
  locator(selector: string): Locator
  getByLabel(nombre: string): Locator
  getByText(texto: string | RegExp): Locator
  getByRole(rol: 'button', opciones: { name: RegExp }): Locator
  evaluate(fn: () => void): Promise<void>
  video(): { path(): Promise<string> } | null
}

interface OpcionesContexto {
  viewport: { width: number; height: number }
  deviceScaleFactor?: number
  locale?: string
  timezoneId?: string
  recordVideo?: { dir: string; size: { width: number; height: number } }
}

interface BrowserContext {
  newPage(): Promise<Page>
  close(): Promise<void>
}

interface Browser {
  newContext(opciones: OpcionesContexto): Promise<BrowserContext>
  close(): Promise<void>
}

interface Playwright {
  chromium: { launch(opciones?: { args?: string[] }): Promise<Browser> }
}

const requerir = createRequire(join(homedir(), '.claude/skills/gstack/package.json'))
const { chromium } = requerir('playwright') as Playwright

// —————— Ajustes ——————

const ANCHO = 1600
const ALTO = 1000

/** Milisegundos por carácter al teclear. Una persona escribe entre 40 y 90. */
const VELOCIDAD_TECLEO = 55

const argumento = (nombre: string, porDefecto: string): string => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : (process.argv[i + 1] ?? porDefecto)
}

const BASE = argumento('url', 'http://localhost:3100').replace(/\/$/, '')
const TELEFONO = '+573001234567'
const SALIDA = resolve(argumento('salida', 'video'))
const CRUDO = join(SALIDA, '.crudo')

/**
 * El guion, escrito para que la negociación se mueva **dentro** de los rangos.
 *
 * Pedir 4 cuotas es lo que hace la demo: el cliente demo autoriza hasta 4 en
 * mora media, así que el agente re-propone en vez de escalar y se ve negociando
 * de verdad. La rama de escalamiento va en su propio clip, porque termina la
 * conversación y no encaja en el mismo arco.
 */
const GUION = [
  { texto: 'Buenas, ¿esto qué es?', esperaAntes: 2500 },
  { texto: 'Sí, soy yo. Pero no tengo cómo pagar todo de una', esperaAntes: 3000 },
  { texto: '¿Y no me lo pueden dejar en 4 cuotas?', esperaAntes: 3200 },
  { texto: 'Listo, hagámosle así', esperaAntes: 2800 },
]

const GUION_ESCALAMIENTO = [
  { texto: 'No tengo cómo pagar todo de una', esperaAntes: 2500 },
  { texto: '¿Y si me lo dejan en 12 cuotas?', esperaAntes: 3200 },
]

// —————— Utilidades ——————

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function reiniciar(): Promise<void> {
  await fetch(`${BASE}/api/demo/conversacion`, { method: 'DELETE' })
}

async function estado(): Promise<{ pago: { referencia: string } | null; estadoCaso: string }> {
  const r = await fetch(`${BASE}/api/demo/conversacion?telefono=${encodeURIComponent(TELEFONO)}`)
  return (await r.json()) as { pago: { referencia: string } | null; estadoCaso: string }
}

async function abrirContexto(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 2,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    recordVideo: { dir: CRUDO, size: { width: ANCHO, height: ALTO } },
  })
}

/**
 * Escribe y envía como lo haría una persona: pausa antes de empezar, teclea, y
 * espera a que el agente responda. La espera se hace contra el DOM, no con un
 * `sleep` fijo: el modelo tarda distinto en cada turno y un sleep corto cortaría
 * la respuesta a la mitad.
 */
async function decir(page: Page, texto: string, esperaAntes: number): Promise<void> {
  await esperar(esperaAntes)

  const burbujasAntes = await page.locator('[data-burbuja]').count()
  const entrada = page.getByLabel('Escribe un mensaje')

  await entrada.click()
  await entrada.pressSequentially(texto, { delay: VELOCIDAD_TECLEO })
  await esperar(400)
  await page.getByLabel('Enviar').click()

  // Dos burbujas nuevas: la del deudor y la del agente.
  await page
    .locator('[data-burbuja]')
    .nth(burbujasAntes + 1)
    .waitFor({ timeout: 90_000 })
  await esperar(1200)
}

/** Deja la traza del panel a la vista sin marear con el scroll. */
async function seguirElPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const traza = document.querySelector('[data-traza]')
    traza?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
  await esperar(900)
}

async function cerrarYRenombrar(
  contexto: BrowserContext,
  page: Page,
  nombre: string,
): Promise<string> {
  const video = page.video()
  await contexto.close()
  const origen = await video?.path()
  if (!origen) throw new Error('Playwright no dejó video')

  const destino = join(SALIDA, `${nombre}.webm`)
  renameSync(origen, destino)
  return destino
}

/**
 * webm → mp4 h264. Lo que entiende cualquier reproductor y cualquier presentación.
 *
 * Sin `scale`: cada clip se grabó a su propio tamaño y forzar un ancho común
 * deformaba el del checkout, que es cuadrado. `yuv420p` sí hace falta —sin él,
 * Quick Look y Keynote no reproducen el archivo.
 */
function aMp4(webm: string, mp4: string): void {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webm,
      '-vf', 'format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '20',
      '-movflags', '+faststart',
      '-r', '30',
      mp4,
    ],
    { stdio: 'pipe' },
  )
}

// —————— Toma principal ——————

async function tomaPrincipal(browser: Browser): Promise<string> {
  await reiniciar()

  const contexto = await abrirContexto(browser)
  const page = await contexto.newPage()
  await page.goto(`${BASE}/demo?limpio=1`, { waitUntil: 'networkidle' })
  await esperar(2200)

  for (const paso of GUION) {
    await decir(page, paso.texto, paso.esperaAntes)
    await seguirElPanel(page)
  }

  /**
   * El modelo no siempre manda el link al primer «listo»: a veces confirma el
   * acuerdo y espera. Un deudor real pediría el link, así que eso hace el
   * guion. Es una salvaguarda del rodaje, no un truco: si hicieran falta más de
   * dos empujones, el problema sería el prompt y hay que arreglarlo ahí.
   */
  const EMPUJONES = ['¿Me manda el link para pagar?', 'Sí, mándemelo por favor']
  let pago = (await estado()).pago
  for (const empujon of EMPUJONES) {
    if (pago) break
    await decir(page, empujon, 2200)
    await seguirElPanel(page)
    pago = (await estado()).pago
  }
  if (!pago) throw new Error('el agente no generó link de pago; revisa el prompt')

  await esperar(2000)

  // El pago ocurre en un contexto aparte, que no se graba: así el teléfono
  // recibe la confirmación **solo**, sin que nadie lo toque. Es el momento que
  // vende el producto.
  const pagador = await browser.newContext({ viewport: { width: 900, height: 900 } })
  const paginaPago = await pagador.newPage()
  await paginaPago.goto(`${BASE}/pagar/${pago.referencia}`, { waitUntil: 'networkidle' })
  await paginaPago.getByRole('button', { name: /^Pagar/ }).click()
  await paginaPago.getByText('Pago aprobado').waitFor({ timeout: 20_000 })
  await pagador.close()

  // El sondeo de la pantalla corre cada 1,5 s.
  await page.getByText(/Recibido/).first().waitFor({ timeout: 30_000 })
  await esperar(1800)
  await seguirElPanel(page)
  await esperar(2600)

  return cerrarYRenombrar(contexto, page, 'ponox-demo')
}

// —————— Clip del checkout ——————

async function tomaCheckout(browser: Browser, referencia: string): Promise<string> {
  const contexto = await browser.newContext({
    viewport: { width: 900, height: 900 },
    deviceScaleFactor: 2,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    recordVideo: { dir: CRUDO, size: { width: 900, height: 900 } },
  })
  const page = await contexto.newPage()
  await page.goto(`${BASE}/pagar/${referencia}`, { waitUntil: 'networkidle' })
  await esperar(2600)
  await page.getByRole('button', { name: /Nequi/ }).click()
  await esperar(1400)
  await page.getByRole('button', { name: /^Pagar/ }).click()
  await page.getByText('Pago aprobado').waitFor({ timeout: 20_000 })
  await esperar(2600)

  return cerrarYRenombrar(contexto, page, 'ponox-pago')
}

// —————— Clip del escalamiento ——————

async function tomaEscalamiento(browser: Browser): Promise<string> {
  await reiniciar()

  const contexto = await abrirContexto(browser)
  const page = await contexto.newPage()
  await page.goto(`${BASE}/demo?limpio=1`, { waitUntil: 'networkidle' })
  await esperar(2000)

  for (const paso of GUION_ESCALAMIENTO) {
    await decir(page, paso.texto, paso.esperaAntes)
    await seguirElPanel(page)
  }
  await esperar(2600)

  return cerrarYRenombrar(contexto, page, 'ponox-escalamiento')
}

// —————— Corrida ——————

rmSync(CRUDO, { recursive: true, force: true })
mkdirSync(SALIDA, { recursive: true })

const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] })

console.log('▸ toma principal…')
const principal = await tomaPrincipal(browser)

// La referencia del cobro que quedó de la toma principal sirve para el clip del
// checkout: hay que generar uno nuevo porque aquel ya está pagado.
await reiniciar()
await fetch(`${BASE}/api/demo/mensaje`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ telefono: TELEFONO, texto: 'No tengo cómo pagar todo de una' }),
})
await fetch(`${BASE}/api/demo/mensaje`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ telefono: TELEFONO, texto: 'Listo, mándeme el link' }),
})
const { pago } = await estado()

console.log('▸ clip del checkout…')
const checkout = pago ? await tomaCheckout(browser, pago.referencia) : null

console.log('▸ clip del escalamiento…')
const escalamiento = await tomaEscalamiento(browser)

await browser.close()

console.log('▸ convirtiendo a mp4…')
const salidas: string[] = []
for (const webm of [principal, checkout, escalamiento].filter(Boolean) as string[]) {
  const mp4 = webm.replace(/\.webm$/, '.mp4')
  aMp4(webm, mp4)
  rmSync(webm)
  salidas.push(mp4)
}

rmSync(CRUDO, { recursive: true, force: true })
// Playwright a veces deja el directorio con archivos sueltos si algo falló.
for (const sobrante of readdirSync(SALIDA).filter((f) => f.endsWith('.webm'))) {
  rmSync(join(SALIDA, sobrante))
}

console.log('\nListo:')
for (const s of salidas) console.log(`  ${s}`)
