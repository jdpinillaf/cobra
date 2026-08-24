import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarDemo, telefonoProtagonista } from './estado'
import { aplicarPago, recibirMensaje, responderComoHumano, vistaPorTelefono } from './servicio'

/**
 * Casos de QA para el pipeline de la demo: secuencias raras, no el camino feliz.
 */

vi.stubEnv('CEREBRO', 'guionado')

const URL_BASE = 'http://localhost:3000'
const TELEFONO = telefonoProtagonista()

const decir = (texto: string) => recibirMensaje({ telefono: TELEFONO, texto, urlBase: URL_BASE })
const tomarElHilo = (autor = 'Marcela') =>
  responderComoHumano({ telefono: TELEFONO, texto: 'Yo sigo desde acá.', autor })

beforeEach(() => {
  reiniciarDemo()
})

// ─────────────────────────────────────────────────────────────────────────────
// C1. Pausa + ráfaga de mensajes del deudor
// ─────────────────────────────────────────────────────────────────────────────

describe('C1 · pausado y el deudor manda cinco mensajes seguidos', () => {
  it('el hilo crece exactamente en cinco y ninguno es del bot', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()

    const antes = vistaPorTelefono()!.mensajes.length
    for (let i = 1; i <= 5; i += 1) await decir(`mensaje ${i}`)
    const vista = vistaPorTelefono()!

    expect(vista.mensajes).toHaveLength(antes + 5)
    expect(vista.mensajes.slice(antes).every((m) => m.de === 'deudor')).toBe(true)
  })

  it('los cinco entrantes quedan en auditoría, ninguno como bloqueado', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()

    const antes = vistaPorTelefono()!.auditoria
    for (let i = 1; i <= 5; i += 1) await decir(`mensaje ${i}`)

    expect(vistaPorTelefono()!.auditoria).toBe(antes + 5)
  })

  it('la conversación sigue en `humano` tras la ráfaga', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()
    for (let i = 1; i <= 5; i += 1) await decir(`mensaje ${i}`)

    expect(vistaPorTelefono()!.estadoCaso).toBe('humano')
  })

  /**
   * `agentePausado` se escribe con `agregarPaso`, no con `agregarPasoSiCambia`:
   * cinco mensajes dejan cinco pasos idénticos en la traza que se le muestra al
   * cliente.
   */
  it('la traza NO se llena de pasos `agentePausado` repetidos', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()
    for (let i = 1; i <= 5; i += 1) await decir(`mensaje ${i}`)

    const pausas = vistaPorTelefono()!.traza.filter((p) => p.herramienta === 'agentePausado')
    expect(pausas).toHaveLength(1)
  })

  it('el asesor puede intercalar respuestas sin que el bot se despierte', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()
    const agentesAntes = vistaPorTelefono()!.mensajes.filter((m) => m.de === 'agente').length

    await decir('uno')
    responderComoHumano({ telefono: TELEFONO, texto: 'ya le reviso', autor: 'Marcela' })
    await decir('dos')

    const mensajes = vistaPorTelefono()!.mensajes
    expect(mensajes.filter((m) => m.de === 'agente')).toHaveLength(agentesAntes)
    expect(mensajes.filter((m) => m.de === 'humano')).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C2. Opt-out sobre una conversación ya pausada
// ─────────────────────────────────────────────────────────────────────────────

describe('C2 · opt-out con la conversación ya pausada', () => {
  it('revoca el consentimiento igual', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()
    const vista = await decir('no me contacten más, por favor')

    expect(vista?.expediente.consentimiento.revocadoEn).not.toBeNull()
    expect(vista?.traza.some((p) => p.herramienta === 'optOut')).toBe(true)
  })

  /**
   * El opt-out se evalúa ANTES de la compuerta, y su rama manda la despedida
   * sin consultar el modo. Con un asesor en el hilo, el bot escribe encima —
   * que es exactamente el bug que la pausa venía a cerrar.
   */
  it('BUG: el bot NO debería escribir la despedida si un asesor tiene el hilo', async () => {
    await decir('quiero hablar con alguien')
    tomarElHilo()

    const antes = vistaPorTelefono()!.mensajes.length
    const vista = await decir('no me contacten más')

    // Debería crecer solo con el entrante del deudor.
    expect(vista!.mensajes).toHaveLength(antes + 1)
    expect(vista!.mensajes.at(-1)!.de).toBe('deudor')
  })

  it('BUG: un segundo opt-out pisa la fecha de revocación original', async () => {
    vi.useFakeTimers()
    try {
      const t0 = new Date()
      vi.setSystemTime(t0)
      await decir('no me contacten más')
      const primera = vistaPorTelefono()!.expediente.consentimiento.revocadoEn

      vi.setSystemTime(new Date(t0.getTime() + 3_600_000))
      const vista = await decir('ya les dije, no me escriban')

      // La fecha en que el deudor pidió la baja es la evidencia ante la SIC.
      // Cada mensaje de baja posterior la reescribe hacia adelante.
      expect(vista!.expediente.consentimiento.revocadoEn).toBe(primera)
    } finally {
      vi.useRealTimers()
    }
  })

  it('BUG: un segundo mensaje de baja hace que el bot vuelva a despedirse', async () => {
    await decir('no me contacten más')
    const vista = await decir('ya les dije, no me escriban')

    // El opt-out corre ANTES de la compuerta, así que el bloqueo absoluto por
    // `opt_out` que ya está activo no llega a callarlo.
    const despedidas = vista!.mensajes.filter((m) => m.texto.startsWith('Listo. No le volvemos'))
    expect(despedidas).toHaveLength(1)
  })

  it('tras el opt-out, un mensaje normal queda registrado pero sin respuesta', async () => {
    await decir('no me contacten más')
    const antes = vistaPorTelefono()!.mensajes.length
    const vista = await decir('bueno, ¿pero cuánto debo?')

    expect(vista!.mensajes).toHaveLength(antes + 1)
    expect(vista!.mensajes.at(-1)!.de).toBe('deudor')
  })

  it('el opt-out deja un contacto bloqueado en auditoría solo desde el SIGUIENTE mensaje', async () => {
    await decir('no me contacten más')
    const antes = vistaPorTelefono()!.auditoria
    await decir('hola?')
    // Entrante + saliente bloqueado = 2.
    expect(vistaPorTelefono()!.auditoria).toBe(antes + 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C3. Mensajes degenerados
// ─────────────────────────────────────────────────────────────────────────────

describe('C3 · mensajes degenerados', () => {
  it('un mensaje vacío no rompe el pipeline', async () => {
    await expect(decir('')).resolves.not.toBeNull()
  })

  it('un mensaje vacío igual queda registrado en el hilo y en auditoría', async () => {
    const antes = vistaPorTelefono()!.auditoria
    const vista = await decir('')

    expect(vista!.mensajes.some((m) => m.de === 'deudor' && m.texto === '')).toBe(true)
    expect(vista!.auditoria).toBeGreaterThan(antes)
  })

  it('un mensaje vacío no dispara un opt-out', async () => {
    const vista = await decir('')
    expect(vista!.expediente.consentimiento.revocadoEn).toBeNull()
  })

  it('un mensaje de solo espacios tampoco rompe', async () => {
    await expect(decir('     ')).resolves.not.toBeNull()
  })

  it('un mensaje de 1000 caracteres se procesa y se guarda entero', async () => {
    const largo = 'a'.repeat(1000)
    const vista = await decir(largo)

    expect(vista!.mensajes.some((m) => m.de === 'deudor' && m.texto === largo)).toBe(true)
    expect(vista!.mensajes.at(-1)!.de).toBe('agente')
  })

  it('1000 caracteres que contienen "baja" enterrada igual disparan el opt-out', async () => {
    const largo = `${'x'.repeat(900)} dar de baja ${'y'.repeat(80)}`
    const vista = await decir(largo)

    expect(vista!.expediente.consentimiento.revocadoEn).not.toBeNull()
  })

  it('un mensaje con emoji y saltos de línea no rompe', async () => {
    await expect(decir('hola 👋\n\n¿me pueden ayudar?\t— gracias')).resolves.not.toBeNull()
  })

  it('el mismo texto cinco veces no duplica pasos de guard en la traza', async () => {
    for (let i = 0; i < 5; i += 1) await decir('hola')
    const pasos = vistaPorTelefono()!.traza.filter((p) => p.herramienta === 'guardLey2300')
    expect(pasos).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C4. Pago después de que la conversación cambió de manos
// ─────────────────────────────────────────────────────────────────────────────

describe('C4 · pago fuera de secuencia', () => {
  it('BUG: tras el opt-out, la confirmación de pago igual le escribe al deudor', async () => {
    await decir('No tengo cómo pagar todo de una')
    const conLink = await decir('Listo, hagámosle en dos')
    const referencia = conLink!.pago!.referencia

    await decir('no me contacten más')
    const antes = vistaPorTelefono()!.mensajes.length

    aplicarPago(referencia)

    // El deudor revocó. `aplicarPago` no consulta la compuerta antes de escribir.
    expect(vistaPorTelefono()!.mensajes).toHaveLength(antes)
  })

  it('BUG: con un asesor en el hilo, la confirmación de pago también escribe encima', async () => {
    await decir('No tengo cómo pagar todo de una')
    const conLink = await decir('Listo, hagámosle en dos')
    const referencia = conLink!.pago!.referencia

    tomarElHilo()
    const antes = vistaPorTelefono()!.mensajes.length

    aplicarPago(referencia)

    expect(vistaPorTelefono()!.mensajes).toHaveLength(antes)
  })

  it('BUG: al pagar el saldo completo, el panel se queda en blanco', async () => {
    await decir('No tengo cómo pagar todo de una')
    const conLink = await decir('Listo, hagámosle en dos')
    const pago = conLink!.pago!
    // Pago del total (o de más, como devolvería una pasarela mal configurada).
    ;(pago as { monto: number }).monto = 999_999_999

    expect(aplicarPago(pago.referencia)).toEqual({ ok: true })

    // `buscarPorTelefono` descarta las obligaciones `pagada`, así que la vista
    // desaparece justo en el momento que la demo quiere mostrar.
    const final = vistaPorTelefono()
    expect(final).not.toBeNull()
    expect(final!.expediente.estadoObligacion).toBe('pagada')
    expect(final!.expediente.saldoTotal).toBe(0)
  })
})
