#!/usr/bin/env tsx
/**
 * Convierte una llamada ya ocurrida en un audio que suena a teléfono.
 *
 *   pnpm voz-grabar                 # la última llamada
 *   pnpm voz-grabar <id>            # una en particular
 *   pnpm voz-grabar --todas         # todas las que no tengan audio
 *
 * El audio queda en `public/llamadas/` y la fila apunta a él, así que se
 * reproduce desde `/consola/llamadas/<id>`. La conversación es la real —con sus
 * herramientas ejecutadas y sus límites aplicados—; lo único simulado es la
 * telefonía.
 */
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { grabarLlamada } from '../src/voz/grabar'
import { costoDeLlamadaCop } from '../src/channels/tarifas'

const ejecutar = promisify(execFile)

/** La duración real del archivo, en segundos. */
async function duracionDe(archivo: string): Promise<number> {
  const { stdout } = await ejecutar('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo,
  ])
  return Math.round(Number(stdout.trim()))
}
import { obtenerDb, TENANT_DEV } from '../src/repo/conexion'

if (!process.env.DEEPGRAM_API_KEY) {
  console.error('\n  falta DEEPGRAM_API_KEY\n')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('\n  falta DATABASE_URL\n')
  process.exit(1)
}

/**
 * El nombre del archivo dice qué pasó en la llamada.
 *
 * Antes era el uuid, y una carpeta con seis uuid obliga a abrirlos uno por uno
 * para encontrar el que se quiere poner en una reunión. El prefijo numérico los
 * ordena por lo que conviene mostrar primero: el que cierra con pago arriba, el
 * que prueba cumplimiento abajo.
 */
const ORDEN: Record<string, number> = {
  acuerdo: 1,
  promesa: 2,
  escalado: 3,
  sin_acuerdo: 4,
  numero_errado: 5,
  baja: 6,
  sin_contacto: 7,
}

const QUE_PASO: Record<string, string> = {
  acuerdo: 'acuerdo-y-link',
  promesa: 'acuerdo-sin-link',
  escalado: 'escala-a-una-persona',
  sin_acuerdo: 'sin-acuerdo',
  numero_errado: 'numero-errado',
  baja: 'pidio-la-baja',
  sin_contacto: 'buzon',
}

const enRuta = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const db = await obtenerDb()
const tenantId = process.env.TENANT_ID ?? TENANT_DEV
const todas = process.argv.includes('--todas')
const id = process.argv[2]?.startsWith('-') ? undefined : process.argv[2]

const filas = await db.query<{ id: string; nombre: string; resultado: string | null }>(
  todas
    ? `SELECT l.id, d.nombre, l.resultado FROM llamadas l
         JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
        WHERE l.tenant_id = $1 AND l.grabacion_url IS NULL AND l.estado <> 'en_curso'
        ORDER BY l.iniciada_en`
    : id
      ? `SELECT l.id, d.nombre, l.resultado FROM llamadas l
           JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
          WHERE l.tenant_id = $1 AND l.id = $2`
      : `SELECT l.id, d.nombre, l.resultado FROM llamadas l
           JOIN deudores d ON d.tenant_id = l.tenant_id AND d.id = l.deudor_id
          WHERE l.tenant_id = $1 AND l.estado <> 'en_curso'
          ORDER BY l.iniciada_en DESC LIMIT 1`,
  id && !todas ? [tenantId, id] : [tenantId],
)

if (filas.length === 0) {
  console.error('\n  no hay llamadas para grabar\n')
  process.exit(1)
}

await mkdir('public/llamadas', { recursive: true })

for (const fila of filas) {
  const turnos = await db.query<{ quien: 'agente' | 'deudor' | 'sistema'; texto: string }>(
    `SELECT quien, texto FROM llamada_turnos
      WHERE tenant_id = $1 AND llamada_id = $2 ORDER BY indice`,
    [tenantId, fila.id],
  )
  if (turnos.length === 0) {
    console.log(`  ${fila.id}  sin turnos, se salta`)
    continue
  }

  const resultado = fila.resultado ?? 'sin_acuerdo'
  const nombreArchivo = `${ORDEN[resultado] ?? 9}-${QUE_PASO[resultado] ?? resultado}--${enRuta(fila.nombre)}.mp3`
  const archivo = `public/llamadas/${nombreArchivo}`
  process.stdout.write(`  ${fila.nombre.padEnd(20)} ${turnos.length} turnos… `)

  await grabarLlamada({
    turnos,
    destino: archivo,
    apiKey: process.env.DEEPGRAM_API_KEY,
    conTimbre: true,
  })

  /**
   * La duración y el costo se recalculan sobre el audio.
   *
   * Antes salían del reloj virtual de la simulación, y quedaban unos segundos
   * por debajo del archivo: el encabezado decía 1:36 y el reproductor 1:47.
   * Ahora el audio **es** la llamada, así que es lo que manda — y el costo,
   * que se factura por minuto redondeado hacia arriba, tiene que salir de la
   * misma cifra o la cuenta que se le muestra al cliente no cuadra con lo que
   * oye.
   */
  const segundos = await duracionDe(archivo)
  const costo = costoDeLlamadaCop(segundos, { grabada: true })

  await db.query(
    `UPDATE llamadas
        SET grabacion_url = $3, duracion_seg = $4,
            costo_telefonia_cop = $5, costo_ia_cop = $6
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, fila.id, `/llamadas/${nombreArchivo}`, segundos, costo.telefoniaCop, costo.iaCop],
  )
  console.log(`✓ ${String(segundos).padStart(3)}s · ${nombreArchivo}`)
}

console.log('\n  se reproducen en /consola/llamadas/<id>\n')
process.exit(0)
