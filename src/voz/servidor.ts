/**
 * El servidor que atiende el Media Stream de Twilio.
 *
 * Corre **fuera de Vercel**: las Vercel Functions no exponen el evento
 * `upgrade` que un WebSocket bidireccional necesita, y una llamada de cobranza
 * son minutos de socket abierto. Precedente en el repo: `workers/correo/`.
 *
 * Un solo puerto para el health check y para el upgrade, así el túnel es uno
 * solo. El TwiML no vive acá: va en línea en `calls.create`, que es un endpoint
 * público menos que exponer.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Db } from '@/repo/db'
import { crearHerramientas, type ContextoHerramientas } from '@/agent/herramientas'
import { abrirPuerto } from '@/agent/puerto-pg'
import { limitesDelTramo } from '@/agent/cerebro'
import { construirPrompt } from '@/agent/prompt'
import { enBogota } from '@/compliance/reloj-bogota'
import { abrirLlamada } from '@/repo/cobranza/llamadas'
import type { LimitesNegociacion } from '@/domain/types'
import { AgenteDeepgram, configDeepgramDesdeEntorno } from './deepgram'
import { DiarioPostgres } from './diario-pg'
import { declararFunciones } from './funciones'
import { leerEventoTwilio, tramaLimpiar, tramaMedia } from './protocolo-twilio'
import { abrirPuente, type SalidaTwilio } from './puente'
import { abrirVale } from './vale'
import { saludoDe } from './llamar'

export interface ConfigServidorVoz {
  puerto: number
  secretoVale: string
  db: Db
  urlBase: string
}

export function crearServidorVoz(config: ConfigServidorVoz): {
  servidor: Server
  cerrar(): Promise<void>
} {
  const http = createServer((peticion, respuesta) => {
    if (peticion.url?.startsWith('/salud')) {
      respuesta.writeHead(200, { 'content-type': 'application/json' })
      respuesta.end(JSON.stringify({ ok: true, voz: 'deepgram' }))
      return
    }
    respuesta.writeHead(404).end('no')
  })

  const wss = new WebSocketServer({ noServer: true })

  http.on('upgrade', (peticion: IncomingMessage, socket: Duplex, cabeza: Buffer) => {
    /**
     * El WebSocket está expuesto por el túnel y **Twilio no lo firma**: sin el
     * vale, cualquiera que descubra la URL abre una sesión contra la cartera de
     * un cliente y se pone a negociar acuerdos en su nombre.
     */
    const url = new URL(peticion.url ?? '/', 'http://local')
    const vale = url.pathname.split('/').filter(Boolean)[1] ?? ''
    const datos = abrirVale(vale, config.secretoVale)

    if (!datos) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(peticion, socket, cabeza, (ws) => {
      void atender(ws, datos, config)
    })
  })

  http.listen(config.puerto)

  return {
    servidor: http,
    async cerrar() {
      await new Promise<void>((listo) => {
        wss.close(() => http.close(() => listo()))
      })
    },
  }
}

async function atender(
  ws: WebSocket,
  datos: ReturnType<typeof abrirVale> & object,
  config: ConfigServidorVoz,
): Promise<void> {
  const dg = configDeepgramDesdeEntorno()
  if (!dg) {
    ws.close(1011, 'sin DEEPGRAM_API_KEY')
    return
  }

  const puerto = await abrirPuerto(config.db, datos.tenantId, {
    conversacionId: datos.conversacionId,
    obligacionId: datos.obligacionId,
  })
  if (!puerto) {
    ws.close(1011, 'sin expediente')
    return
  }

  const [cliente] = await config.db.query<{
    nombre: string
    limites_por_tramo: Record<string, LimitesNegociacion> | null
  }>(
    `SELECT t.nombre, c.limites_por_tramo FROM tenants t
       LEFT JOIN tenant_cobranza c ON c.tenant_id = t.id WHERE t.id = $1`,
    [datos.tenantId],
  )

  const limites = limitesDelTramo(cliente?.limites_por_tramo ?? {}, puerto.obligacion.tramo)
  const fechaHoy = enBogota(new Date()).fecha
  const ctx: ContextoHerramientas = {
    puerto,
    limites,
    fechaHoy,
    urlBase: config.urlBase,
    canal: 'voz',
  }
  const herramientas = crearHerramientas(ctx)

  const { id: llamadaId } = await abrirLlamada(config.db, datos.tenantId, {
    deudorId: datos.deudorId,
    obligacionId: datos.obligacionId,
    conversacionId: datos.conversacionId,
    telefono: datos.telefono,
    direccion: 'saliente',
    proveedor: 'twilio',
    agente: `deepgram/${dg.voz}`,
  })

  let streamSid = ''
  const salida: SalidaTwilio = {
    enviarMedia: (mulaw) => {
      if (streamSid && ws.readyState === ws.OPEN) ws.send(tramaMedia(streamSid, mulaw))
    },
    limpiar: () => {
      if (streamSid && ws.readyState === ws.OPEN) ws.send(tramaLimpiar(streamSid))
    },
    colgar: () => {
      if (ws.readyState === ws.OPEN) ws.close(1000, 'fin')
    },
  }

  const puente = await abrirPuente({
    agente: new AgenteDeepgram(dg),
    salida,
    diario: new DiarioPostgres(config.db, datos.tenantId, llamadaId, { grabada: true }),
    herramientas,
    puerto,
    funciones: await declararFunciones(herramientas),
    prompt: construirPrompt({
      cliente: { nombre: cliente?.nombre ?? 'la empresa' },
      deudor: puerto.deudor,
      obligacion: puerto.obligacion,
      limites,
      fechaHoy,
      canal: 'voz',
    }),
    saludo: saludoDe(cliente?.nombre ?? 'la empresa', puerto.deudor.nombre),
  })

  console.log(`  ▸ llamada ${llamadaId} · ${puerto.deudor.nombre}`)

  ws.on('message', (crudo: Buffer) => {
    const evento = leerEventoTwilio(crudo.toString('utf8'))
    switch (evento.evento) {
      case 'start':
        streamSid = evento.streamSid
        return
      case 'media':
        puente.recibirAudio(evento.mulaw)
        return
      case 'stop':
        void puente.terminar('colgo')
        return
      default:
        return
    }
  })

  ws.on('close', () => void puente.terminar('socket_cerrado'))
  ws.on('error', () => void puente.terminar('error_de_socket'))
}
