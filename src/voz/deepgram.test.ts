import { describe, expect, it } from 'vitest'
import { AgenteDeepgram, type SocketMinimo } from './deepgram'
import type { OpcionesAgente, TurnoVoz } from './agente'
import type { PedidoDeFuncion } from './funciones'

/** Un socket de mentira que deja inspeccionar lo que se le mandó. */
class SocketDePrueba implements SocketMinimo {
  readonly enviados: (string | Uint8Array)[] = []
  cerrado = false
  private manejadores: Record<string, ((e: never) => void)[]> = {}

  send(d: string | Uint8Array) { this.enviados.push(d) }
  close() { this.cerrado = true }
  addEventListener(tipo: string, fn: (e: never) => void) {
    ;(this.manejadores[tipo] ??= []).push(fn)
  }
  emitir(tipo: string, e?: unknown) {
    for (const fn of this.manejadores[tipo] ?? []) fn(e as never)
  }
  get textos(): string[] {
    return this.enviados.filter((x): x is string => typeof x === 'string')
  }
}

function armar() {
  const socket = new SocketDePrueba()
  const turnos: TurnoVoz[] = []
  const audio: Uint8Array[] = []
  const pedidos: PedidoDeFuncion[] = []
  let interrupciones = 0
  const errores: unknown[] = []

  const opciones: OpcionesAgente = {
    prompt: 'Eres el agente.',
    saludo: 'Buenos días.',
    funciones: [
      { name: 'consultarCartera', description: 'trae el expediente', parameters: {} },
    ],
    alAudio: (m) => audio.push(m),
    alInterrumpir: () => { interrupciones += 1 },
    alTurno: (t) => turnos.push(t),
    alPedirFuncion: (p) => pedidos.push(...p),
    alCerrar: () => {},
    alError: (e) => errores.push(e),
  }

  const agente = new AgenteDeepgram({ apiKey: 'llave', voz: 'aura-2-celeste-es' }, () => socket)
  return { socket, agente, opciones, turnos, audio, pedidos, errores, cuantasInterrupciones: () => interrupciones }
}

describe('AgenteDeepgram', () => {
  it('manda los ajustes apenas abre, antes de un solo byte de audio', async () => {
    const { socket, agente, opciones } = armar()
    await agente.iniciar(opciones)
    expect(socket.enviados).toHaveLength(0)

    socket.emitir('open')
    const ajustes = JSON.parse(socket.textos[0])
    expect(ajustes.type).toBe('Settings')
    expect(ajustes.agent.language).toBe('es')
    expect(ajustes.agent.greeting).toBe('Buenos días.')
    expect(ajustes.audio.input).toEqual({ encoding: 'mulaw', sample_rate: 8000 })
  })

  /**
   * Twilio empieza a mandar audio antes de que el socket de Deepgram termine
   * de abrir. Descartarlo se oiría como que la llamada arranca sorda.
   */
  it('encola el audio que llega antes de estar abierto y lo suelta después', async () => {
    const { socket, agente, opciones } = armar()
    await agente.iniciar(opciones)

    agente.enviarAudio(new Uint8Array([1, 2, 3]))
    expect(socket.enviados).toHaveLength(0)

    socket.emitir('open')
    const binarios = socket.enviados.filter((x) => x instanceof Uint8Array)
    expect(binarios).toHaveLength(1)
  })

  it('convierte los frames binarios en audio del agente', async () => {
    const { socket, agente, opciones, audio } = armar()
    await agente.iniciar(opciones)
    socket.emitir('open')
    socket.emitir('message', { data: new Uint8Array([9, 9]) })
    expect(audio).toHaveLength(1)
    expect([...audio[0]]).toEqual([9, 9])
  })

  it('avisa la interrupción del deudor', async () => {
    const { socket, agente, opciones, cuantasInterrupciones } = armar()
    await agente.iniciar(opciones)
    socket.emitir('open')
    socket.emitir('message', { data: '{"type":"UserStartedSpeaking"}' })
    expect(cuantasInterrupciones()).toBe(1)
  })

  it('reporta los pedidos de función con su id', async () => {
    const { socket, agente, opciones, pedidos } = armar()
    await agente.iniciar(opciones)
    socket.emitir('open')
    socket.emitir('message', {
      data: JSON.stringify({
        type: 'FunctionCallRequest',
        functions: [{ id: 'f1', name: 'consultarCartera', arguments: '{"motivo":"x"}' }],
      }),
    })
    expect(pedidos).toEqual([{ id: 'f1', name: 'consultarCartera', arguments: '{"motivo":"x"}' }])

    agente.responderFuncion({ id: 'f1', name: 'consultarCartera', contenido: '{"ok":true}' })
    const respuesta = JSON.parse(socket.textos.at(-1) as string)
    expect(respuesta).toMatchObject({ type: 'FunctionCallResponse', id: 'f1' })
  })

  it('un `Error` del proveedor llega como error, no como silencio', async () => {
    const { socket, agente, opciones, errores } = armar()
    await agente.iniciar(opciones)
    socket.emitir('open')
    socket.emitir('message', { data: '{"type":"Error","description":"llave inválida"}' })
    expect(errores).toHaveLength(1)
    expect(String(errores[0])).toContain('llave inválida')
  })
})
