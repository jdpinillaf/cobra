/**
 * Una llamada simulada, de punta a punta y contra la base real.
 *
 * Es al canal de voz lo que `src/bandeja/simular-entrante.ts` es a WhatsApp:
 * un camino que **escribe filas de verdad y ejecuta las herramientas de
 * verdad**, sin abrir una puerta hacia afuera. No hay Twilio, no hay Deepgram y
 * no hay audio; hay un acuerdo validado, un link de pago con referencia real,
 * una transcripción y un resumen.
 *
 * Las cerraduras son las mismas que las de la simulación de WhatsApp, y por el
 * mismo motivo: una llamada que nos inventamos no puede contar como evidencia
 * ante la SIC ni sumar en consumo.
 *
 * 1. Exige `tenants.modo_demo`, que es `false` por defecto.
 * 2. La fila queda con `proveedor = 'simulado'`, para siempre.
 */
import type { Db } from '@/repo/db'
import { crearHerramientas, type ContextoHerramientas } from '@/agent/herramientas'
import { abrirPuerto } from '@/agent/puerto-pg'
import { limitesDelTramo } from '@/agent/cerebro'
import { construirPrompt } from '@/agent/prompt'
import { enBogota } from '@/compliance/reloj-bogota'
import { abrirLlamada } from '@/repo/cobranza/llamadas'
import { declararFunciones } from './funciones'
import { abrirPuente, type SalidaTwilio } from './puente'
import { AgenteVozSimulado, GUIONES, relojVirtual, type GuionDeVoz } from './simulado'
import { AgenteVozLlm } from './agente-llm'
import { crearDeudorIa, PERSONAJES, type Personaje } from './deudor-ia'
import { modeloDelCerebro } from '@/agent/modelo'
import { DiarioPostgres } from './diario-pg'
import type { TurnoVoz } from './agente'

export interface ResultadoSimulacion {
  llamadaId: string
  turnos: readonly TurnoVoz[]
  acciones: ReadonlyArray<{ nombre: string; estado: string }>
}

/** El audio no va a ninguna parte: nadie está escuchando. */
class SalidaMuda implements SalidaTwilio {
  colgada = false
  enviarMedia(): void {}
  limpiar(): void {}
  colgar(): void {
    this.colgada = true
  }
}

export async function llamadaSimulada(
  db: Db,
  tenantId: string,
  params: {
    conversacionId: string
    obligacionId: string
    deudorId: string
    telefono: string
    guion?: keyof typeof GUIONES | GuionDeVoz
    /**
     * Quién actúa al deudor.
     *
     * Con un personaje, la conversación la improvisan dos modelos y cada
     * corrida sale distinta. Sin él, corre el guion determinista — que sigue
     * sirviendo para grabar algo repetible y para cuando no hay llave.
     */
    personaje?: keyof typeof PERSONAJES | Personaje
    clienteNombre: string
    limitesPorTramo: Parameters<typeof limitesDelTramo>[0]
    urlBase: string
  },
): Promise<ResultadoSimulacion> {
  const [tenant] = await db.query<{ modo_demo: boolean }>(
    `SELECT modo_demo FROM tenants WHERE id = $1`,
    [tenantId],
  )
  if (!tenant?.modo_demo) {
    throw new Error(
      'este tenant no tiene modo_demo: una llamada inventada no puede entrar a una cartera real',
    )
  }

  const puerto = await abrirPuerto(db, tenantId, {
    conversacionId: params.conversacionId,
    obligacionId: params.obligacionId,
  })
  if (!puerto) throw new Error('no se pudo abrir el puerto del agente para esa obligación')

  const limites = limitesDelTramo(params.limitesPorTramo, puerto.obligacion.tramo)
  const fechaHoy = enBogota(new Date()).fecha
  const ctx: ContextoHerramientas = {
    puerto,
    limites,
    fechaHoy,
    urlBase: params.urlBase,
    canal: 'voz',
  }
  const herramientas = crearHerramientas(ctx)

  const guion =
    typeof params.guion === 'string' ? (GUIONES[params.guion] ?? GUIONES.cuotas) : (params.guion ?? GUIONES.cuotas)

  // Un solo reloj para los dos: el agente espera contra él y el puente mide la
  // duración con él. Si fueran distintos, la llamada duraría lo que tardó el
  // proceso en vez de lo que habría durado la conversación.
  const reloj = relojVirtual()

  const personaje =
    typeof params.personaje === 'string' ? PERSONAJES[params.personaje] : params.personaje
  const deudorIa = personaje ? crearDeudorIa(personaje, puerto.deudor.nombre) : null

  const agente = deudorIa
    ? new AgenteVozLlm(deudorIa, herramientas, reloj, modeloDelCerebro()?.etiqueta ?? 'llm', {
        deudor: puerto.deudor,
        obligacion: puerto.obligacion,
        limites,
      })
    : new AgenteVozSimulado(
        guion,
        { deudor: puerto.deudor, obligacion: puerto.obligacion, limites },
        reloj,
      )

  // La llamada se abre **después** de armar el agente: `agente` queda escrito
  // con quién habló de verdad. Cambiar de modelo a mitad de un piloto y no
  // poder separar las llamadas después es perder el experimento.
  const { id: llamadaId } = await abrirLlamada(db, tenantId, {
    deudorId: params.deudorId,
    obligacionId: params.obligacionId,
    conversacionId: params.conversacionId,
    telefono: params.telefono,
    direccion: 'saliente',
    proveedor: 'simulado',
    agente: deudorIa ? `${agente.nombre} vs ${personaje?.clave}` : agente.nombre,
  })

  let cerrado = false
  const diario = new DiarioPostgres(db, tenantId, llamadaId, { grabada: true })

  const puente = await abrirPuente({
    agente,
    salida: new SalidaMuda(),
    diario: {
      anotarTurno: (t) => diario.anotarTurno(t),
      marcarInterrumpido: (i) => diario.marcarInterrumpido(i),
      anotarAccion: (a) => diario.anotarAccion(a),
      cerrar: async (c) => {
        await diario.cerrar(c)
        cerrado = true
      },
    },
    herramientas,
    funciones: await declararFunciones(herramientas),
    prompt: construirPrompt({
      cliente: { nombre: params.clienteNombre },
      deudor: puerto.deudor,
      obligacion: puerto.obligacion,
      limites,
      fechaHoy,
      canal: 'voz',
    }),
    saludo: saludoDe(params.clienteNombre, puerto.deudor.nombre),
    // La baja la decide el código sobre lo que dijo la persona, no el modelo.
    puerto,
    ahora: reloj.ahora,
    // El guardia del buzón mide contra el reloj virtual, que salta de golpe:
    // con el temporizador real nunca dispararía en un guion que corre en
    // milisegundos, y con el virtual dispararía siempre.
    programar: () => ({ cancelar: () => {} }),
  })

  /**
   * Esperar el final.
   *
   * Con guion se sabe cuántos turnos van a salir. Con dos modelos improvisando
   * no: la señal es `alCerrar`, que el puente convierte en el cierre. Por eso
   * se espera a que el diario haya cerrado, con un tope por si un modelo se
   * cuelga.
   */
  await esperarCierre(() => cerrado, deudorIa ? 240_000 : 10_000)
  await puente.terminar(deudorIa ? 'colgo' : 'guion_terminado')

  return {
    llamadaId,
    turnos: puente.turnos,
    acciones: puente.acciones.map((a) => ({ nombre: a.nombre, estado: a.estado })),
  }
}

/**
 * La primera frase de la llamada.
 *
 * El aviso de grabación va en el saludo y no después: en Colombia hay que
 * avisarlo, y avisarlo tarde es no avisarlo. Cuesta ~3 s, que con el redondeo
 * de Twilio al minuto no cambia la factura.
 */
export function saludoDe(cliente: string, deudor: string): string {
  const primerNombre = deudor.split(' ')[0]
  // Sin punto propio después del nombre de la empresa: muchas razones sociales
  // terminan en «S.A.S.» y quedaba un punto doble, que el TTS lee como pausa.
  const empresa = cliente.replace(/\.$/, '')
  return `Buenos días, ¿hablo con ${primerNombre}? Le llamamos de ${empresa}. Esta llamada es grabada.`
}

/** Espera a que el diario haya cerrado, con tope. */
async function esperarCierre(leer: () => boolean, topeMs: number): Promise<void> {
  const hasta = Date.now() + topeMs
  while (!leer() && Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, 50))
  }
}
