/**
 * Tres orígenes del mismo dinero, con los descuadres que aparecen de verdad.
 *
 * Existe para poder mostrar la conciliación entre portales **hoy**, sin
 * credenciales de nadie. Los tres salen de un solo generador determinista, así
 * que los descuadres están puestos a propósito y se pueden explicar uno por uno
 * en la reunión — que es muy distinto a un dato aleatorio que nadie sabe leer.
 *
 * Cada portal devuelve la respuesta con **su** forma: nombres de campo
 * distintos y el arreglo colgando de otro lugar. Es lo que justifica que
 * `FuenteApi` tenga `camino` y `mapeo`, y lo que va a pasar de verdad el día
 * que se conecte un Siigo o un Bancolombia.
 */

export interface MovimientoDemo {
  referencia: string
  cliente: string
  fecha: string
  centavos: number
}

const NOMBRES = [
  'Ana Ruiz', 'Jorge Ospina', 'Marta Salas', 'Iván Torres', 'Luz Ramírez',
  'Carlos Peña', 'Diana Díaz', 'Fernando Zapata', 'Sofía Cano', 'Andrés Mora',
]

/** Generador propio: `Math.random` haría que la demo cambie entre dos corridas. */
function aleatorio(semilla: number): () => number {
  let s = semilla
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export interface CarteraDemo {
  /** Lo que dice el software contable. Es la referencia. */
  contable: MovimientoDemo[]
  /** Lo que dice el portal del banco. */
  banco: MovimientoDemo[]
  /** El Excel con el que trabaja la operación. */
  excel: MovimientoDemo[]
  /** Qué se plantó y por qué, para poder explicarlo en la reunión. */
  plantados: Array<{ referencia: string; que: string }>
}

export function generarCarteraDemo(cantidad = 80, semilla = 21): CarteraDemo {
  const rnd = aleatorio(semilla)

  const contable: MovimientoDemo[] = []
  for (let i = 1; i <= cantidad; i++) {
    contable.push({
      referencia: `FV-${String(i).padStart(4, '0')}`,
      cliente: NOMBRES[Math.floor(rnd() * NOMBRES.length)],
      fecha: `2026-0${1 + Math.floor(rnd() * 7)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
      centavos: Math.round((150_000 + rnd() * 3_850_000)) * 100,
    })
  }

  const banco = contable.map((m) => ({ ...m }))
  const excel = contable.map((m) => ({ ...m }))
  const plantados: CarteraDemo['plantados'] = []

  const marcar = (i: number, que: string) =>
    plantados.push({ referencia: contable[i].referencia, que })

  // 1. Un pago que el banco recibió y el contable nunca registró. Es el caso
  //    caro: plata que entró y nadie aplicó a la factura.
  excel.splice(12, 1)
  contable.splice(12, 1)
  marcar(12, 'el banco lo recibió; ni el contable ni el Excel lo tienen')

  // 2. Dos facturas que el Excel no tiene: alguien no las pasó.
  for (const i of [40, 25]) {
    excel.splice(i, 1)
    marcar(i, 'no está en el Excel de la operación')
  }

  // 3. Un IVA mal aplicado en el Excel: el contable y el banco coinciden.
  excel[8].centavos = Math.round(excel[8].centavos * 1.19)
  marcar(8, 'el Excel le sumó IVA; contable y banco coinciden entre sí')

  // 4. Un dedo gordo en el contable: banco y Excel coinciden.
  contable[33].centavos = contable[33].centavos + 100_000_00
  marcar(33, 'el contable tiene un millón de más; banco y Excel coinciden')

  // 5. Un abono parcial: el banco recibió menos de lo facturado.
  banco[50].centavos = Math.round(banco[50].centavos * 0.6)
  marcar(50, 'el banco recibió un abono parcial')

  // 6. Un cobro por fuera del sistema, que solo está en el Excel.
  excel.push({
    referencia: 'FV-9001',
    cliente: 'Marta Salas',
    fecha: '2026-08-14',
    centavos: 1_450_000_00,
  })
  plantados.push({ referencia: 'FV-9001', que: 'cobro por fuera del sistema, solo en el Excel' })

  // 7. Una fila del banco ilegible, que siempre hay.
  ;(banco[60] as unknown as { centavos: string }).centavos = 'PENDIENTE'
  plantados.push({ referencia: banco[60].referencia, que: 'el banco devolvió el valor ilegible' })

  return { contable, banco, excel, plantados }
}

/** El contable: arreglo en `data`, campos en inglés como los portales reales. */
export function comoPortalContable(movimientos: MovimientoDemo[]): unknown {
  return {
    meta: { source: 'demo-contable', count: movimientos.length },
    data: movimientos.map((m) => ({
      docNumber: m.referencia,
      customerName: m.cliente,
      issueDate: m.fecha,
      total: m.centavos / 100,
      currency: 'COP',
    })),
  }
}

/** El banco: arreglo en `resultado.movimientos`, campos en español y montos como texto. */
export function comoPortalBanco(movimientos: MovimientoDemo[]): unknown {
  return {
    resultado: {
      movimientos: movimientos.map((m) => ({
        Referencia: m.referencia,
        FechaMovimiento: m.fecha,
        // Como texto y con separadores de miles, que es como llegan de verdad.
        Valor:
          typeof m.centavos === 'number'
            ? (m.centavos / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })
            : String(m.centavos),
        Concepto: 'ABONO A FACTURA',
      })),
    },
  }
}
