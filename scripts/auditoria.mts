#!/usr/bin/env tsx
/**
 * Auditoría de rendimiento del repo.
 *
 * Corre después de cada módulo. No mide el producto en producción — para eso
 * está `agent_events.latencia_ms` — mide el bucle en el que trabajamos: cuánto
 * tarda la suite, cuánto el typecheck, y cuál archivo se está poniendo lento.
 *
 * Existe porque una suite que pasa de 1 s a 30 s no se nota el día que ocurre,
 * se nota tres semanas después cuando ya nadie la corre antes de commitear. La
 * tendencia vive en `.auditoria.jsonl`, que es lo único que permite ver eso.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'

const HISTORIAL = '.auditoria.jsonl'

interface Medicion {
  ts: string
  commit: string
  tests: number
  archivos: number
  suiteMs: number
  typecheckMs: number
  lineasCodigo: number
  lineasTest: number
  dependencias: number
  masLento: { archivo: string; ms: number } | null
  /** Los cinco caminos del producto. Es la barra de progreso de todo el build. */
  e2eVerdes: number
  e2eTotal: number
}

function correr(cmd: string, args: string[]): { salida: string; ms: number } {
  const t0 = performance.now()
  let salida = ''
  try {
    salida = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    salida = String((e as { stdout?: string }).stdout ?? '')
  }
  return { salida, ms: Math.round(performance.now() - t0) }
}

/**
 * Cuenta solo el motor, no la UI.
 *
 * `src/components` y `src/app` son landing, escena 3D y rutas: se prueban con
 * E2E y con el ojo, no con tests unitarios. Meterlos en el ratio lo diluye
 * hasta que el aviso no significa nada.
 */
function contarLineas(soloTests: boolean): number {
  const filtro = soloTests ? "grep '\\.test\\.'" : "grep -v '\\.test\\.'"
  const { salida } = correr('bash', [
    '-c',
    `find src -name '*.ts' -not -path 'src/app/*' -not -path 'src/components/*' | ${filtro} | xargs wc -l | tail -1`,
  ])
  return Number(salida.trim().split(/\s+/)[0] ?? 0)
}

const commit = correr('git', ['rev-parse', '--short', 'HEAD']).salida.trim()

const suite = correr('pnpm', [
  'vitest', 'run', '--exclude', 'src/e2e/**', '--reporter=json', '--outputFile=.vitest.json',
])
const reporte = existsSync('.vitest.json')
  ? (JSON.parse(readFileSync('.vitest.json', 'utf8')) as {
      numTotalTests: number
      numTotalTestSuites: number
      testResults: { name: string; startTime: number; endTime: number }[]
    })
  : null

const porArchivo = (reporte?.testResults ?? [])
  .map((r) => ({ archivo: r.name.replace(process.cwd() + '/', ''), ms: r.endTime - r.startTime }))
  .sort((a, b) => b.ms - a.ms)

// Los E2E se miden aparte y en rojo a propósito: hasta que el sistema exista
// son la lista de lo que falta, no una regresión.
const e2e = correr('pnpm', [
  'vitest', 'run', 'src/e2e', '--reporter=json', '--outputFile=.vitest-e2e.json',
])
void e2e
const reporteE2e = existsSync('.vitest-e2e.json')
  ? (JSON.parse(readFileSync('.vitest-e2e.json', 'utf8')) as {
      numTotalTests: number
      numPassedTests: number
    })
  : null

const typecheck = correr('pnpm', ['typecheck'])
const deps = Object.keys(
  JSON.parse(readFileSync('package.json', 'utf8')).dependencies ?? {},
).length

const m: Medicion = {
  ts: new Date().toISOString(),
  commit,
  tests: reporte?.numTotalTests ?? 0,
  archivos: reporte?.testResults.length ?? 0,
  suiteMs: suite.ms,
  typecheckMs: typecheck.ms,
  lineasCodigo: contarLineas(false),
  lineasTest: contarLineas(true),
  dependencias: deps,
  masLento: porArchivo[0] ?? null,
  e2eVerdes: reporteE2e?.numPassedTests ?? 0,
  e2eTotal: reporteE2e?.numTotalTests ?? 0,
}

const previas = existsSync(HISTORIAL)
  ? readFileSync(HISTORIAL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Medicion)
  : []
const anterior = previas.at(-1)

const delta = (ahora: number, antes: number | undefined): string => {
  if (antes === undefined) return ''
  const d = ahora - antes
  if (d === 0) return '  ='
  return `  ${d > 0 ? '+' : ''}${d}`
}

console.log(`\nAuditoría · ${commit}\n${'─'.repeat(46)}`)
console.log(`tests            ${String(m.tests).padStart(8)}${delta(m.tests, anterior?.tests)}`)
console.log(`archivos         ${String(m.archivos).padStart(8)}${delta(m.archivos, anterior?.archivos)}`)
console.log(`suite            ${String(m.suiteMs).padStart(7)}ms${delta(m.suiteMs, anterior?.suiteMs)}`)
console.log(`typecheck        ${String(m.typecheckMs).padStart(7)}ms${delta(m.typecheckMs, anterior?.typecheckMs)}`)
console.log(`líneas código    ${String(m.lineasCodigo).padStart(8)}${delta(m.lineasCodigo, anterior?.lineasCodigo)}`)
console.log(`líneas test      ${String(m.lineasTest).padStart(8)}${delta(m.lineasTest, anterior?.lineasTest)}`)
console.log(`ratio test/cód   ${String((m.lineasTest / (m.lineasCodigo || 1)).toFixed(2)).padStart(8)}`)
console.log(`dependencias     ${String(m.dependencias).padStart(8)}${delta(m.dependencias, anterior?.dependencias)}`)
const barra = '█'.repeat(m.e2eVerdes) + '░'.repeat(Math.max(0, m.e2eTotal - m.e2eVerdes))
console.log(`\ncaminos E2E      ${String(`${m.e2eVerdes}/${m.e2eTotal}`).padStart(8)}  ${barra}`)
if (m.masLento) console.log(`más lento        ${m.masLento.archivo} (${Math.round(m.masLento.ms)}ms)`)

// Umbrales. No fallan el build, avisan. Un umbral que rompe el build se termina
// subiendo hasta que no significa nada.
const avisos: string[] = []
if (m.suiteMs > 30_000) avisos.push('la suite pasó de 30 s: ya nadie la va a correr antes de commitear')
if (m.typecheckMs > 20_000) avisos.push('el typecheck pasó de 20 s')
if (m.lineasTest < m.lineasCodigo * 0.5) avisos.push('menos de media línea de test por línea de código')
if (m.masLento && m.masLento.ms > m.suiteMs * 0.4) avisos.push(`un solo archivo se lleva el 40% de la suite: ${m.masLento.archivo}`)
if (avisos.length) console.log(`\n⚠ ${avisos.join('\n⚠ ')}`)

appendFileSync(HISTORIAL, JSON.stringify(m) + '\n')
console.log(`\n${previas.length + 1} mediciones en ${HISTORIAL}\n`)
