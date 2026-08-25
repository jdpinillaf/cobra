import { describe, expect, it } from 'vitest'
import { cruzar, cruzarVarias, normalizarClave, type Fila } from './cruce'

const OPCIONES = { clave: 'referencia', monto: 'valor' }

describe('normalizarClave', () => {
  it('iguala las formas en que dos archivos escriben la misma referencia', () => {
    expect(normalizarClave(' cr-00034 ')).toBe('CR00034')
    expect(normalizarClave('CR 00034')).toBe('CR00034')
    expect(normalizarClave('CR.00034')).toBe('CR00034')
  })

  /**
   * Los ceros a la izquierda **no** se tocan: `00034` y `34` pueden ser dos
   * créditos distintos, y fusionarlos inventaría un cuadre que no existe.
   */
  it('no borra ceros a la izquierda', () => {
    expect(normalizarClave('00034')).not.toBe(normalizarClave('34'))
  })
})

describe('cruzar', () => {
  it('clasifica los cuatro descuadres y suma el valor en riesgo al centavo', () => {
    const contable: Fila[] = [
      { referencia: 'CR-001', valor: '1.000.000' }, // cuadra
      { referencia: 'CR-002', valor: '500.000' }, // el Excel dice 450.000
      { referencia: 'CR-003', valor: '250.000' }, // no está en el Excel
    ]
    const excel: Fila[] = [
      { referencia: 'cr001', valor: '1000000' }, // misma clave, otro formato
      { referencia: 'CR-002', valor: '450.000' },
      { referencia: 'CR-004', valor: '80.000' }, // no está en el contable
    ]

    const r = cruzar(contable, excel, OPCIONES)

    expect(r.resumen).toEqual({
      cuadra: 1,
      monto_distinto: 1,
      falta_en_excel: 1,
      falta_en_contable: 1,
      duplicado: 0,
    })
    // 50.000 de diferencia + 250.000 que falta + 80.000 que sobra.
    expect(r.valorEnRiesgoCentavos).toBe(38_000_000)
    expect(r.totalContableCentavos).toBe(175_000_000)
    expect(r.totalExcelCentavos).toBe(153_000_000)
  })

  /** Lo que no cuadra va primero, y lo más caro arriba. */
  it('ordena por lo que hay que trabajar', () => {
    const r = cruzar(
      [{ referencia: 'A', valor: '100' }, { referencia: 'B', valor: '900000' }],
      [{ referencia: 'A', valor: '100' }],
      OPCIONES,
    )
    expect(r.filas[0].clave).toBe('B')
    expect(r.filas.at(-1)?.descuadre).toBe('cuadra')
  })

  /** Dos filas con la misma referencia suelen ser dos abonos: se suman. */
  it('suma los duplicados en vez de quedarse con el último', () => {
    const r = cruzar(
      [{ referencia: 'A', valor: '60.000' }, { referencia: 'A', valor: '40.000' }],
      [{ referencia: 'A', valor: '100.000' }],
      OPCIONES,
    )
    expect(r.resumen.duplicado).toBe(1)
    expect(r.filas[0].contableCentavos).toBe(10_000_000)
    // Cuadra en total, así que no hay plata en riesgo — pero queda marcado,
    // porque dos filas iguales también pueden ser un pago cargado dos veces.
    expect(r.valorEnRiesgoCentavos).toBe(0)
  })

  /**
   * La tolerancia por defecto es cero. «Que no se pierda ningún valor»
   * significa cero, no «casi»: un centavo por fila en diez mil filas son cien
   * mil pesos.
   */
  it('un centavo de diferencia es un descuadre', () => {
    const r = cruzar(
      [{ referencia: 'A', valor: '1000.01' }],
      [{ referencia: 'A', valor: '1000.00' }],
      OPCIONES,
    )
    expect(r.resumen.monto_distinto).toBe(1)
    expect(r.valorEnRiesgoCentavos).toBe(1)
  })

  it('respeta una tolerancia explícita', () => {
    const r = cruzar(
      [{ referencia: 'A', valor: '1000.01' }],
      [{ referencia: 'A', valor: '1000.00' }],
      { ...OPCIONES, toleranciaCentavos: 1 },
    )
    expect(r.resumen.cuadra).toBe(1)
  })

  /**
   * Una fila ilegible no puede tumbar el cruce: un archivo de 8.000 registros
   * con 30 celdas rotas tiene que cruzar 7.970 y reportar las 30.
   */
  it('manda a cuarentena lo ilegible y cruza el resto', () => {
    const r = cruzar(
      [
        { referencia: 'A', valor: '100' },
        { referencia: '', valor: '999' },
        { referencia: 'C', valor: 'mil pesos' },
      ],
      [{ referencia: 'A', valor: '100' }],
      OPCIONES,
    )
    expect(r.resumen.cuadra).toBe(1)
    expect(r.ilegibles).toHaveLength(2)
    expect(r.ilegibles[0]).toMatchObject({ origen: 'contable', numeroFila: 3 })
    expect(r.ilegibles[1].motivo).toContain('valor')
  })

  it('no revienta con archivos vacíos', () => {
    const r = cruzar([], [], OPCIONES)
    expect(r.filas).toEqual([])
    expect(r.valorEnRiesgoCentavos).toBe(0)
  })
})

describe('cruzarVarias', () => {
  const O = { clave: 'referencia', monto: 'valor' }
  const fuente = (clave: string, filas: Fila[]) => ({ clave, nombre: clave, filas })

  it('cuadra cuando las tres fuentes dicen lo mismo', () => {
    const r = cruzarVarias(
      [
        fuente('contable', [{ referencia: 'A', valor: '100.000' }]),
        fuente('banco', [{ referencia: 'a', valor: '100000' }]),
        fuente('excel', [{ referencia: 'A ', valor: 100000 }]),
      ],
      O,
    )
    expect(r.resumen.cuadra).toBe(1)
    expect(r.valorEnRiesgoCentavos).toBe(0)
  })

  /**
   * Lo que un cruce de dos no puede decir: con tres fuentes se sabe **quién**
   * se salió, no solo que hay diferencia.
   */
  it('señala la fuente que se desvía de las otras dos', () => {
    const r = cruzarVarias(
      [
        fuente('contable', [{ referencia: 'A', valor: '100.000' }]),
        fuente('banco', [{ referencia: 'A', valor: '100.000' }]),
        fuente('excel', [{ referencia: 'A', valor: '90.000' }]),
      ],
      O,
    )
    expect(r.filas[0].estado).toBe('monto_distinto')
    expect(r.filas[0].sospechosa).toBe('excel')
    expect(r.valorEnRiesgoCentavos).toBe(1_000_000)
  })

  /** Con dos fuentes que difieren no hay a quién creerle: no se inventa culpable. */
  it('no acusa a nadie cuando solo hay dos y no coinciden', () => {
    const r = cruzarVarias(
      [
        fuente('contable', [{ referencia: 'A', valor: '100.000' }]),
        fuente('excel', [{ referencia: 'A', valor: '90.000' }]),
      ],
      O,
    )
    expect(r.filas[0].sospechosa).toBeNull()
  })

  it('marca en qué fuentes falta la referencia', () => {
    const r = cruzarVarias(
      [
        fuente('contable', [{ referencia: 'A', valor: '100.000' }]),
        fuente('banco', []),
        fuente('excel', [{ referencia: 'A', valor: '100.000' }]),
      ],
      O,
    )
    expect(r.filas[0].estado).toBe('falta_en_alguna')
    expect(r.filas[0].faltaEn).toEqual(['banco'])
    expect(r.filas[0].porFuente.banco).toBeNull()
    // Lo que falta se cuenta por el monto que sí se conoce.
    expect(r.valorEnRiesgoCentavos).toBe(10_000_000)
  })

  it('dice de qué fuente vino cada fila ilegible', () => {
    const r = cruzarVarias(
      [
        fuente('contable', [{ referencia: 'A', valor: '100' }]),
        fuente('banco', [{ referencia: 'A', valor: 'ilegible' }]),
      ],
      O,
    )
    expect(r.ilegibles).toHaveLength(1)
    expect(r.ilegibles[0].origen).toBe('banco')
  })
})
