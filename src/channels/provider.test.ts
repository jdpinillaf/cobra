import { describe, expect, it } from 'vitest'
import { ProveedorSimulado, canalDelIntento, formatearCop, interpolar, tarifaDe } from './provider'

describe('interpolar', () => {
  it('reemplaza las variables posicionales de Meta', () => {
    expect(interpolar('Hola {{1}}, tu saldo es {{2}}.', ['Ana', '$1.245.000'])).toBe(
      'Hola Ana, tu saldo es $1.245.000.',
    )
  })

  it('deja intacto lo que no tiene valor, en vez de escribir undefined', () => {
    expect(interpolar('Hola {{1}} y {{2}}', ['Ana'])).toBe('Hola Ana y {{2}}')
  })
})

describe('formatearCop', () => {
  it('formatea pesos sin decimales', () => {
    // El separador de miles del locale es un espacio duro, no un punto ASCII.
    expect(formatearCop(1_245_000).replace(/\s/g, ' ')).toMatch(/^\$\s?1[.\s]245[.\s]000$/)
  })
})

describe('ProveedorSimulado', () => {
  it('registra los envíos y cobra según canal y categoría', async () => {
    const proveedor = new ProveedorSimulado()
    const r = await proveedor.enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'Hola',
      categoria: 'utility',
    })

    expect(r).toMatchObject({ ok: true, estado: 'enviado' })
    expect(r.costoCop).toBeCloseTo(3.2, 2)
    expect(proveedor.enviados).toHaveLength(1)
  })

  it('una respuesta dentro de la ventana de servicio no cuesta nada', async () => {
    const proveedor = new ProveedorSimulado()
    const r = await proveedor.enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'Claro, le explico',
      categoria: 'servicio',
    })

    expect(r.costoCop).toBe(0)
  })

  it('un SMS cuesta unas 65 veces más que una plantilla utility', () => {
    // La brecha es la razón por la que el SMS se factura aparte del cupo: a
    // COP 45 de overage se perdería plata en cada uno.
    const utility = tarifaDe('whatsapp').costoCop('whatsapp', 'utility')
    const sms = tarifaDe('sms').costoCop('sms', 'utility')

    expect(sms).toBeCloseTo(210, 2)
    expect(sms / utility).toBeCloseTo(65.6, 1)
  })

  it('simula un fallo para poder probar el fallback', async () => {
    const proveedor = new ProveedorSimulado()
    proveedor.programarFallo('+573001112233')

    const fallido = await proveedor.enviar({
      para: '+573001112233',
      canal: 'whatsapp',
      cuerpo: 'x',
      categoria: 'utility',
    })
    expect(fallido).toMatchObject({ ok: false, estado: 'fallido', costoCop: 0 })
    expect(proveedor.enviados).toHaveLength(0)

    // El fallo es de un solo uso: el reintento pasa.
    const segundo = await proveedor.enviar({
      para: '+573001112233',
      canal: 'sms',
      cuerpo: 'x',
      categoria: 'utility',
    })
    expect(segundo.ok).toBe(true)
  })
})

describe('canalDelIntento', () => {
  it('usa siempre WhatsApp en el primer intento', () => {
    expect(canalDelIntento('whatsapp', false, true)).toBe('whatsapp')
  })

  it('cae a SMS solo si WhatsApp falló y el paso lo autoriza', () => {
    expect(canalDelIntento('whatsapp', true, true)).toBe('sms')
    expect(canalDelIntento('whatsapp', true, false)).toBeNull()
  })

  it('no reintenta un SMS fallido por otro canal', () => {
    expect(canalDelIntento('sms', true, true)).toBeNull()
  })
})
