import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarDemo, telefonoProtagonista } from './estado'
import { aplicarPago, recibirMensaje, responderComoHumano, vistaPorTelefono } from './servicio'

/**
 * El pipeline completo, extremo a extremo, con el cerebro guionado.
 *
 * Vale la pena tenerlo aunque sea código de demo: es el único lugar donde se
 * verifica que el orden de los pasos se respeta (entrante → ventana → opt-out →
 * guard → respuesta) y que la referencia efectivamente cierra la obligación. Ese
 * orden se documenta en `procesador-webhook.ts:43-49` y es fácil de romper sin
 * darse cuenta al reordenar un `if`.
 */

// El modelo no se llama nunca en tests: sería lento, caro y no determinista.
vi.stubEnv('CEREBRO', 'guionado')

const URL_BASE = 'http://localhost:3000'
const TELEFONO = telefonoProtagonista()

const decir = (texto: string) => recibirMensaje({ telefono: TELEFONO, texto, urlBase: URL_BASE })

beforeEach(() => {
  reiniciarDemo()
})

describe('la conversación arranca lista', () => {
  it('trae el recordatorio de la cadencia ya enviado', () => {
    const vista = vistaPorTelefono()

    expect(vista).not.toBeNull()
    expect(vista?.estadoCaso).toBe('contactado')
    expect(vista?.mensajes).toHaveLength(1)
    expect(vista?.mensajes[0].de).toBe('agente')
    // El recordatorio invita a escribir; el link nace de la negociación.
    expect(vista?.mensajes[0].texto).not.toContain('http')
  })

  it('trae el expediente que el panel necesita', () => {
    const e = vistaPorTelefono()?.expediente

    expect(e?.numeroCredito).toBe('CR-04471')
    expect(e?.diasMora).toBe(43)
    expect(e?.tramo).toBe('media')
    expect(e?.saldoTotal).toBe(1_840_000)
  })

  it('devuelve null para un número que no está en la cartera', () => {
    expect(vistaPorTelefono('+573009999999')).toBeNull()
  })
})

describe('recorrido hasta el pago', () => {
  it('negocia, genera el link y concilia contra la obligación', async () => {
    const negociacion = await decir('No tengo cómo pagar todo de una')
    expect(negociacion?.acuerdo?.numeroCuotas).toBe(2)
    expect(negociacion?.estadoCaso).toBe('acuerdo')

    const conLink = await decir('Listo, hagámosle en dos')
    const referencia = conLink?.pago?.referencia
    expect(referencia).toMatch(/^COB-obl_\d+-/)
    // El marcador tiene que haber quedado sustituido por una URL de verdad.
    expect(conLink?.mensajes.at(-1)?.texto).toContain(`${URL_BASE}/pagar/${referencia}`)
    expect(conLink?.mensajes.at(-1)?.texto).not.toContain('{{link}}')

    expect(aplicarPago(referencia!)).toEqual({ ok: true })

    const final = vistaPorTelefono()
    expect(final?.pago?.estado).toBe('aprobado')
    // Pagó una de dos cuotas: baja el saldo pero la obligación no se cierra.
    expect(final?.expediente.saldoTotal).toBe(920_000)
    expect(final?.expediente.estadoObligacion).toBe('acuerdo_vigente')
    expect(final?.mensajes.at(-1)?.texto).toContain('Recibido su pago')
  })

  it('atribuye el pago al agente: entró tras un contacto suyo', async () => {
    await decir('No tengo cómo pagar todo de una')
    const conLink = await decir('Listo, hagámosle en dos')
    aplicarPago(conLink!.pago!.referencia)

    expect(vistaPorTelefono()?.pago?.atribuidoAlAgente).toBe(true)
  })

  it('el mismo pago dos veces no descuenta dos veces', async () => {
    await decir('No tengo cómo pagar todo de una')
    const conLink = await decir('Listo, hagámosle en dos')
    const referencia = conLink!.pago!.referencia

    aplicarPago(referencia)
    aplicarPago(referencia)

    expect(vistaPorTelefono()?.expediente.saldoTotal).toBe(920_000)
  })

  it('rechaza una referencia que no existe', () => {
    expect(aplicarPago('COB-inventada-x').ok).toBe(false)
  })
})

describe('las salidas que no terminan en pago', () => {
  it('escala cuando piden más cuotas de las autorizadas, sin generar link', async () => {
    const vista = await decir('¿Y si me lo dejan en 8 cuotas?')

    expect(vista?.estadoCaso).toBe('humano')
    expect(vista?.acuerdo).toBeNull()
    expect(vista?.pago).toBeNull()
  })

  it('registra el entrante ANTES de aplicar el opt-out, para conservar la prueba', async () => {
    const vista = await decir('no me contacten más, por favor')

    expect(vista?.estadoCaso).toBe('humano')
    expect(vista?.expediente.consentimiento.revocadoEn).not.toBeNull()
    // El mensaje que pidió la baja tiene que estar en el hilo.
    expect(vista?.mensajes.some((m) => m.de === 'deudor' && m.texto.includes('no me contacten'))).toBe(true)
    expect(vista?.traza.some((p) => p.herramienta === 'optOut')).toBe(true)
  })

  it('una vez revocado, el agente ya no responde', async () => {
    await decir('no me contacten más')
    const despues = await decir('bueno pero cuánto debo?')

    expect(despues?.traza.at(-1)).toMatchObject({ herramienta: 'guardLey2300', estado: 'bloqueado' })
    expect(despues?.traza.at(-1)?.detalle).toContain('revocó la autorización')
    // El entrante sí queda registrado; lo que no sale es la respuesta.
    expect(despues?.mensajes.at(-1)?.de).toBe('deudor')
  })
})

describe('relevo humano', () => {
  it('inyecta lo que escribe una persona y marca el caso', async () => {
    await decir('No tengo cómo pagar todo de una')

    const vista = responderComoHumano({
      telefono: TELEFONO,
      texto: 'Don Jorge, soy Marcela. Le puedo ayudar con eso.',
      autor: 'Marcela Ríos',
    })

    expect(vista?.estadoCaso).toBe('humano')
    expect(vista?.mensajes.at(-1)).toMatchObject({ de: 'humano', autor: 'Marcela Ríos' })
    expect(vista?.traza.at(-1)?.herramienta).toBe('relevoHumano')
  })

  it('ignora un teléfono sin conversación abierta', () => {
    expect(responderComoHumano({ telefono: '+573009999999', texto: 'hola', autor: 'X' })).toBeNull()
  })
})

describe('registro de auditoría', () => {
  it('guarda cada intento de contacto, entrantes y salientes', async () => {
    const vista = await decir('No tengo cómo pagar todo de una')

    // Recordatorio inicial + entrante + respuesta.
    expect(vista?.auditoria).toBe(3)
  })

  it('deja constancia también de lo que el guard no dejó salir', async () => {
    await decir('no me contacten más')
    const despues = await decir('hola?')

    expect(despues?.traza.some((p) => p.estado === 'bloqueado')).toBe(true)
  })
})

describe('el agente calla cuando un asesor toma la conversación', () => {
  /**
   * Era un bug abierto, no una función que faltaba.
   *
   * `estadoCaso` se ponía en 'humano' desde el escalamiento y desde
   * `responderComoHumano`, pero nadie lo leía como condición para callar: la
   * única lectura del flujo solo promovía `contactado → negociando`. El asesor
   * entraba a la conversación y el bot le contestaba encima al deudor.
   *
   * Dos voces en el mismo hilo es exactamente lo que el cliente está tratando
   * de evitar cuando deja de cobrar desde los celulares de sus vendedores.
   */

  it('no responde al deudor después de que un humano escribió', async () => {
    await decir('quiero hablar con alguien')
    responderComoHumano({ telefono: TELEFONO, texto: 'Hola, soy Marcela del equipo.', autor: 'Marcela' })

    const antes = vistaPorTelefono()!.mensajes.length
    const vista = await decir('bueno, ¿cuánto debo?')

    // El entrante del deudor sí entra. Lo que no aparece es una respuesta del
    // bot detrás: el hilo crece exactamente en uno.
    expect(vista!.mensajes).toHaveLength(antes + 1)
    expect(vista!.mensajes.at(-1)!.de).toBe('deudor')
  })

  it('deja el mensaje del deudor registrado igual, no lo descarta', async () => {
    await decir('quiero hablar con alguien')
    responderComoHumano({ telefono: TELEFONO, texto: 'Ya te ayudo.', autor: 'Marcela' })

    const vista = await decir('mi número es otro')

    // Callar no es ignorar. El mensaje queda en el hilo para que el asesor lo
    // lea, y la traza dice por qué el agente no contestó.
    expect(vista!.mensajes.at(-1)!.texto).toBe('mi número es otro')
    expect(vista!.traza.map((p) => p.herramienta)).toContain('agentePausado')
  })

  it('una pausa no ensucia el log de auditoría con un contacto bloqueado', async () => {
    await decir('quiero hablar con alguien')
    responderComoHumano({ telefono: TELEFONO, texto: 'Ya te ayudo.', autor: 'Marcela' })

    const antes = vistaPorTelefono()!.auditoria
    await decir('ok gracias')

    // El log de contactos es la evidencia ante la SIC de intentos de contacto
    // reales. Una pausa no es un intento bloqueado por la ley: es que un asesor
    // se hizo cargo. Sube en uno, el entrante del deudor, y no en dos.
    expect(vistaPorTelefono()!.auditoria).toBe(antes + 1)
  })
})
