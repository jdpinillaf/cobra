import { describe, expect, it } from 'vitest'
import {
  calcularDiasMora,
  normalizarCelular,
  normalizarDocumento,
  normalizarFecha,
  normalizarMonto,
} from './normalizar'

describe('normalizarCelular', () => {
  it.each([
    ['3001112233', '+573001112233'],
    ['300 111 2233', '+573001112233'],
    ['300-111-2233', '+573001112233'],
    ['(300) 111 2233', '+573001112233'],
    ['+57 300 111 2233', '+573001112233'],
    ['573001112233', '+573001112233'],
    ['+573001112233', '+573001112233'],
    ['03001112233', '+573001112233'],
    ['573001112233 ', '+573001112233'],
  ])('normaliza %s → %s', (crudo, esperado) => {
    const r = normalizarCelular(crudo)
    expect(r.ok && r.valor).toBe(esperado)
  })

  it('acepta el número que Excel guardó como número', () => {
    const r = normalizarCelular(3001112233)
    expect(r.ok && r.valor).toBe('+573001112233')
  })

  it.each(['6012345678', '+576012345678', '6042345678'])(
    'rechaza el fijo %s porque WhatsApp no funciona ahí',
    (fijo) => {
      const r = normalizarCelular(fijo)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/celular/)
    },
  )

  it.each([['', 'vacío'], ['abc', 'inválido'], ['123', 'inválido'], ['30011122', 'inválido']])(
    'rechaza "%s"',
    (crudo) => {
      expect(normalizarCelular(crudo).ok).toBe(false)
    },
  )

  it('rechaza null y undefined sin lanzar', () => {
    expect(normalizarCelular(null).ok).toBe(false)
    expect(normalizarCelular(undefined).ok).toBe(false)
  })
})

describe('normalizarDocumento', () => {
  it.each([
    ['1.020.304.050', '1020304050'],
    ['1020304050', '1020304050'],
    [' 1 020 304 050 ', '1020304050'],
    ['900.123.456-7', '9001234567'],
    [1020304050, '1020304050'],
  ])('normaliza %s → %s', (crudo, esperado) => {
    const r = normalizarDocumento(crudo)
    expect(r.ok && r.valor).toBe(esperado)
  })

  it('rechaza vacío y caracteres raros', () => {
    expect(normalizarDocumento('').ok).toBe(false)
    expect(normalizarDocumento('12/34').ok).toBe(false)
  })
})

describe('normalizarMonto', () => {
  it.each([
    ['1.245.000', 1_245_000],
    ['1,245,000', 1_245_000],
    ['$ 1.245.000', 1_245_000],
    ['$1.245.000,50', 1_245_001],
    ['1,245,000.49', 1_245_000],
    ['1245000', 1_245_000],
    ['1245000,00', 1_245_000],
    ['COP 850.000', 850_000],
    [1_245_000, 1_245_000],
    [1_245_000.6, 1_245_001],
    ['0', 0],
  ])('normaliza %s → %i', (crudo, esperado) => {
    const r = normalizarMonto(crudo)
    expect(r.ok && r.valor).toBe(esperado)
  })

  it('interpreta el separador de más a la derecha como decimal', () => {
    expect(normalizarMonto('1.234,56')).toEqual({ ok: true, valor: 1235 })
    expect(normalizarMonto('1,234.56')).toEqual({ ok: true, valor: 1235 })
  })

  it('un punto con tres decimales es separador de miles, no decimal', () => {
    // "850.000" en Colombia son ochocientos cincuenta mil, no 850 con decimales.
    expect(normalizarMonto('850.000')).toEqual({ ok: true, valor: 850_000 })
  })

  it('lee montos negativos en paréntesis contables', () => {
    expect(normalizarMonto('(50.000)')).toEqual({ ok: true, valor: -50_000 })
    expect(normalizarMonto('-50.000')).toEqual({ ok: true, valor: -50_000 })
  })

  it('rechaza texto no numérico', () => {
    expect(normalizarMonto('pendiente').ok).toBe(false)
    expect(normalizarMonto('').ok).toBe(false)
  })
})

describe('normalizarFecha', () => {
  it.each([
    ['2026-07-20', '2026-07-20'],
    ['2026-07-20T14:00:00Z', '2026-07-20'],
    ['20/07/2026', '2026-07-20'],
    ['20-07-2026', '2026-07-20'],
    ['3/4/2026', '2026-04-03'],
    ['03.04.2026', '2026-04-03'],
    ['20/07/26', '2026-07-20'],
  ])('normaliza %s → %s', (crudo, esperado) => {
    const r = normalizarFecha(crudo)
    expect(r.ok && r.valor).toBe(esperado)
  })

  it('lee el día antes que el mes, como se escribe en Colombia', () => {
    expect(normalizarFecha('03/04/2026')).toEqual({ ok: true, valor: '2026-04-03' })
  })

  it('convierte el serial de Excel', () => {
    // 45000 corresponde al 15 de marzo de 2023 en la época de Excel.
    expect(normalizarFecha(45_000)).toEqual({ ok: true, valor: '2023-03-15' })
  })

  it('acepta un Date directo', () => {
    expect(normalizarFecha(new Date('2026-07-20T00:00:00Z'))).toEqual({
      ok: true,
      valor: '2026-07-20',
    })
  })

  it('rechaza fechas que no existen', () => {
    expect(normalizarFecha('31/02/2026').ok).toBe(false)
    expect(normalizarFecha('2026-13-01').ok).toBe(false)
    expect(normalizarFecha('sin fecha').ok).toBe(false)
  })
})

describe('calcularDiasMora', () => {
  it.each([
    ['2026-07-20', '2026-08-11', 22],
    ['2026-08-11', '2026-08-11', 0],
    ['2026-08-20', '2026-08-11', -9],
  ])('vence %s, corte %s → %i días', (venc, hoy, esperado) => {
    expect(calcularDiasMora(venc, hoy)).toBe(esperado)
  })
})
