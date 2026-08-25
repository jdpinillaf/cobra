import { describe, expect, it } from 'vitest'
import {
  leerEventoTwilio,
  tramaLimpiar,
  tramaMedia,
  trocear,
  twimlConectarStream,
} from './protocolo-twilio'
import { leerEventoDeepgram, tramaAjustes, tramaRespuestaFuncion } from './protocolo-deepgram'
import { abrirVale, firmarVale } from './vale'

describe('protocolo de Twilio', () => {
  it('lee el `start` con los parámetros del TwiML', () => {
    const e = leerEventoTwilio(
      JSON.stringify({
        event: 'start',
        streamSid: 'MZ1',
        start: { callSid: 'CA1', customParameters: { tenantId: 't1', vale: 'abc' } },
      }),
    )
    expect(e).toEqual({
      evento: 'start',
      streamSid: 'MZ1',
      callSid: 'CA1',
      parametros: { tenantId: 't1', vale: 'abc' },
    })
  })

  it('decodifica el audio de base64 a mulaw crudo, ida y vuelta', () => {
    const mulaw = new Uint8Array([0xff, 0x7f, 0x00, 0x80])
    const trama = tramaMedia('MZ1', mulaw)
    const e = leerEventoTwilio(trama)
    expect(e.evento).toBe('media')
    if (e.evento !== 'media') return
    expect([...e.mulaw]).toEqual([...mulaw])
  })

  /** Un evento nuevo de Twilio no puede tumbar la llamada. */
  it('no revienta con un evento que no conoce ni con JSON roto', () => {
    expect(leerEventoTwilio('{"event":"inventado"}').evento).toBe('desconocido')
    expect(leerEventoTwilio('no soy json').evento).toBe('desconocido')
  })

  it('trocea a marcos de 20 ms', () => {
    const t = trocear(new Uint8Array(400))
    expect(t.map((x) => x.length)).toEqual([160, 160, 80])
  })

  it('arma el TwiML con `Connect` y escapa los parámetros', () => {
    const x = twimlConectarStream({
      urlWs: 'wss://a.b/media?x=1&y=2',
      parametros: { vale: 'a"b' },
    })
    expect(x).toContain('<Connect><Stream url="wss://a.b/media?x=1&amp;y=2">')
    expect(x).toContain('<Parameter name="vale" value="a&quot;b"/>')
    // `Start` sería unidireccional: oiríamos al deudor sin poder contestarle.
    expect(x).not.toContain('<Start>')
  })

  it('la trama de limpiar lleva el streamSid', () => {
    expect(JSON.parse(tramaLimpiar('MZ9'))).toEqual({ event: 'clear', streamSid: 'MZ9' })
  })
})

describe('protocolo de Deepgram', () => {
  const AJUSTES = {
    idioma: 'es',
    modeloEscucha: 'nova-3',
    proveedorPensar: 'open_ai' as const,
    modeloPensar: 'gpt-5.6-luna',
    voz: 'aura-2-celeste-es',
    prompt: 'Eres el agente.',
    saludo: 'Buenos días.',
    funciones: [
      { name: 'consultarCartera', description: 'trae el expediente', parameters: {} },
    ],
  }

  it('pide mulaw 8 kHz de los dos lados, que es lo que habla Twilio', () => {
    const s = JSON.parse(tramaAjustes(AJUSTES))
    expect(s.audio.input).toEqual({ encoding: 'mulaw', sample_rate: 8000 })
    expect(s.audio.output).toEqual({ encoding: 'mulaw', sample_rate: 8000, container: 'none' })
  })

  it('manda el prompt, el saludo y las funciones', () => {
    const s = JSON.parse(tramaAjustes(AJUSTES))
    expect(s.agent.language).toBe('es')
    expect(s.agent.greeting).toBe('Buenos días.')
    expect(s.agent.think.prompt).toBe('Eres el agente.')
    expect(s.agent.speak.provider.model).toBe('aura-2-celeste-es')
  })

  /**
   * Deepgram rechaza la conexión entera con `UNPARSABLE_CLIENT_MESSAGE` si las
   * funciones traen `client_side`. El flag viaja al revés: viene dentro del
   * `FunctionCallRequest` para avisar que la ejecución es nuestra. Una función
   * sin `endpoint` ya es del lado del cliente.
   */
  it('no manda `client_side` ni `endpoint` en las funciones', () => {
    const f = JSON.parse(tramaAjustes(AJUSTES)).agent.think.functions[0]
    expect(f).not.toHaveProperty('client_side')
    expect(f).not.toHaveProperty('endpoint')
  })

  /**
   * `Welcome` llega apenas conecta, antes de validar los ajustes. Tratarlo como
   * «listo» fue lo que hizo que un sondeo diera por buena una configuración que
   * Deepgram rechazaba un segundo después.
   */
  it('distingue `Welcome` de `SettingsApplied`', () => {
    expect(leerEventoDeepgram('{"type":"Welcome"}').evento).toBe('conectado')
    expect(leerEventoDeepgram('{"type":"SettingsApplied"}').evento).toBe('listo')
  })

  it('lee el pedido de función y normaliza los argumentos a string', () => {
    const e = leerEventoDeepgram(
      JSON.stringify({
        type: 'FunctionCallRequest',
        functions: [{ id: 'f1', name: 'consultarCartera', arguments: { motivo: 'x' } }],
      }),
    )
    expect(e).toEqual({
      evento: 'pide_funcion',
      pedidos: [{ id: 'f1', name: 'consultarCartera', arguments: '{"motivo":"x"}' }],
    })
  })

  it('reconoce la interrupción del deudor', () => {
    expect(leerEventoDeepgram('{"type":"UserStartedSpeaking"}').evento).toBe('empezo_a_hablar')
  })

  it('separa quién dijo cada cosa', () => {
    const e = leerEventoDeepgram('{"type":"ConversationText","role":"assistant","content":"hola"}')
    expect(e).toEqual({ evento: 'transcripcion', quien: 'agente', texto: 'hola' })
  })

  /**
   * El seguro contra que el contrato no sea el documentado: nada se descarta
   * callado, y el tipo viaja para poder loguearlo y arreglarlo en un commit.
   */
  it('conserva tipo y crudo de lo que no reconoce', () => {
    const e = leerEventoDeepgram('{"type":"AlgoNuevo","x":1}')
    expect(e).toMatchObject({ evento: 'desconocido', tipo: 'AlgoNuevo' })
  })

  it('la respuesta de función lleva el mismo id que el pedido', () => {
    const r = JSON.parse(tramaRespuestaFuncion({ id: 'f1', name: 'x', contenido: '{"ok":true}' }))
    expect(r).toEqual({ type: 'FunctionCallResponse', id: 'f1', name: 'x', content: '{"ok":true}' })
  })
})

describe('vale', () => {
  const SECRETO = 'secreto-de-prueba'
  const DATOS = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    conversacionId: 'c1',
    obligacionId: 'o1',
    deudorId: 'd1',
    telefono: '+573001234567',
  }

  it('ida y vuelta', () => {
    expect(abrirVale(firmarVale(DATOS, SECRETO), SECRETO)).toEqual(DATOS)
  })

  it('rechaza una firma de otro secreto', () => {
    expect(abrirVale(firmarVale(DATOS, SECRETO), 'otro')).toBeNull()
  })

  /** El ataque obvio: cambiar el tenant y quedarse con la firma vieja. */
  it('rechaza un cuerpo manipulado', () => {
    const vale = firmarVale(DATOS, SECRETO)
    const [carga, firma] = vale.split('.')
    const otro = Buffer.from(
      JSON.stringify({ ...DATOS, tenantId: '22222222-2222-4222-8222-222222222222', expiraEn: Date.now() + 1e6 }),
    ).toString('base64url')
    expect(abrirVale(`${otro}.${firma}`, SECRETO)).toBeNull()
    expect(carga).not.toBe(otro)
  })

  it('rechaza un vale vencido', () => {
    const ahora = 1_000_000
    const vale = firmarVale(DATOS, SECRETO, ahora)
    expect(abrirVale(vale, SECRETO, ahora + 299_000)).toEqual(DATOS)
    expect(abrirVale(vale, SECRETO, ahora + 301_000)).toBeNull()
  })

  it('rechaza basura', () => {
    expect(abrirVale('', SECRETO)).toBeNull()
    expect(abrirVale('sinpunto', SECRETO)).toBeNull()
  })
})
