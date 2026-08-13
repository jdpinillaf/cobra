/**
 * Corrida de la demo por consola.
 *
 *   pnpm demo -- --deudores 500 --dias 90
 *
 * Imprime lo que se le muestra al prospecto: recuperación contra grupo de
 * control, costo real de los mensajes, y el anexo de compliance con los envíos
 * que el guard bloqueó y por qué.
 */
import { liquidarMes } from '../src/domain/planes'
import { generarCartera } from '../src/demo/seed'
import { simular, type ResultadoSimulacion } from '../src/demo/simulador'

function argumento(nombre: string, porDefecto: number): number {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i === -1) return porDefecto
  const valor = Number(process.argv[i + 1])
  return Number.isFinite(valor) ? valor : porDefecto
}

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(n)
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const deudores = argumento('deudores', 500)
const dias = argumento('dias', 90)
const fechaInicio = '2026-08-11'

const cartera = generarCartera({ cantidad: deudores, fechaCorte: fechaInicio, semilla: 42 })
const r: ResultadoSimulacion = simular({ cartera, fechaInicio, dias, semilla: 7 })

console.log(`\n  ${cartera.cliente.nombre} — piloto simulado`)
console.log(`  ${r.fechaInicio} → ${r.fechaFin} (${r.diasSimulados} días) · ${deudores} obligaciones\n`)

console.log('  RECUPERACIÓN')
console.log('  ┌─────────────┬────────┬──────────────────┬──────────────────┬────────┐')
console.log('  │ Grupo       │  Oblig │    Cartera       │    Recuperado    │  Tasa  │')
console.log('  ├─────────────┼────────┼──────────────────┼──────────────────┼────────┤')
for (const [etiqueta, g] of [
  ['Con agente', r.tratamiento],
  ['Control', r.control],
] as const) {
  console.log(
    `  │ ${etiqueta.padEnd(11)} │ ${String(g.obligaciones).padStart(6)} │ ${cop(g.saldoInicialCop).padStart(16)} │ ${cop(g.recuperadoCop).padStart(16)} │ ${pct(g.tasaRecuperacion).padStart(6)} │`,
  )
}
console.log('  └─────────────┴────────┴──────────────────┴──────────────────┴────────┘')
console.log(`  Uplift atribuible al agente: ${r.upliftPuntos.toFixed(1)} puntos porcentuales\n`)

// Cartera adicional recuperada que no habría entrado sin el agente.
const extra = r.tratamiento.saldoInicialCop * (r.upliftPuntos / 100)
const meses = Math.max(1, Math.round(dias / 30))
const factura = liquidarMes({
  deudoresGestionados: deudores,
  mensajesPorCanal: { whatsapp: r.mensajes.whatsapp, sms: r.mensajes.sms },
})
// Lo que el cliente paga durante el piloto: setup una vez más la mensualidad.
const costoCliente = factura.plan.setupCop + factura.totalCop * meses

console.log('  ECONOMÍA DEL PILOTO')
console.log(`  Plan                    ${factura.plan.etiqueta} (hasta ${factura.plan.deudoresMax ?? '∞'} deudores)`)
console.log(`  Mensajes enviados       ${r.mensajes.total} de ${factura.mensajesIncluidos} incluidos (${r.mensajes.whatsapp} WhatsApp · ${r.mensajes.sms} SMS)`)
console.log(`  Costo real de mensajes  ${cop(r.mensajes.costoCop)}`)
console.log(`  Setup                   ${cop(factura.plan.setupCop)}`)
console.log(`  Mensualidad × ${meses}         ${cop(factura.totalCop * meses)}`)
console.log(`  ─────────────────────────────────────`)
console.log(`  Paga el cliente         ${cop(costoCliente)}`)
console.log(`  Recupera de más         ${cop(Math.round(extra))}`)
console.log(
  `  Retorno                 ${(extra / costoCliente).toFixed(1)}x sobre lo que paga\n`,
)

console.log('  ANEXO DE COMPLIANCE — Ley 2300 de 2023')
const listar = (registro: Record<string, number>) => {
  for (const [motivo, veces] of Object.entries(registro).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(veces).padStart(5)}  ${motivo.replace(/_/g, ' ')}`)
  }
}
console.log(`  ${r.diferidosTotales} envíos diferidos a una ventana legal (salieron más tarde):`)
listar(r.diferidos as Record<string, number>)
console.log(`\n  ${r.bloqueadosTotales} envíos bloqueados definitivamente (nunca salieron):`)
listar(r.bloqueados as Record<string, number>)
console.log('\n  Cada decisión queda con fecha, hora de Bogotá y motivo en el log de contactos.\n')
