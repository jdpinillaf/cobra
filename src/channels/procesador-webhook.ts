import { detectarNumeroErrado } from './numero-errado'
import { detectarOptOut } from './opt-out'
import {
  interpretarEntrantes,
  interpretarEstados,
  type CambioEstado,
  type MensajeEntrante,
} from './meta-webhook'

/**
 * Orquestación del webhook, separada del transporte.
 *
 * La ruta de Next se queda con lo que solo ella puede hacer —leer el cuerpo
 * crudo y responder HTTP— y todo lo demás pasa por aquí, donde se puede probar
 * con un repositorio en memoria y sin levantar servidor.
 *
 * La persistencia se inyecta porque el repo todavía no tiene base de datos. La
 * forma del puerto ya está definida para que conectarla sea implementar una
 * interfaz, no reescribir el flujo.
 */

export interface RepositorioWebhook {
  /** Idempotencia: Meta reintenta hasta que reciba 200, y reintenta de verdad. */
  yaProcesado(idProveedor: string): Promise<boolean>
  marcarProcesado(idProveedor: string): Promise<void>
  /** Escribe el estado real sobre el `Contacto` que tenga ese `wamid`. */
  actualizarEstado(cambio: CambioEstado): Promise<void>
  /**
   * Registra el entrante como `Contacto` con `direccion: 'entrante'`.
   *
   * Devuelve en qué hilo quedó, o `null` si el número no es de ningún deudor
   * conocido. El id sube hasta el llamador porque es lo que necesita para
   * hacerlo contestar, y buscarlo de nuevo por teléfono sería repetir la
   * consulta que esta función ya hizo.
   */
  registrarEntrante(mensaje: MensajeEntrante): Promise<{ conversacionId: string } | null>
  /** Abre o renueva la ventana de servicio de 24 h del deudor. */
  abrirVentanaServicio(telefono: string, entranteEn: string): Promise<void>
  /** Escribe `Consentimiento.revocadoEn`. El guard ya lo respeta. */
  revocarConsentimiento(telefono: string, en: string): Promise<void>
  /**
   * Escribe `Deudor.numeroErradoEn` y deja el hilo para un humano.
   *
   * Separado de `revocarConsentimiento` porque son dos hechos distintos: la
   * baja la pide el deudor y no se deshace; esto lo afirma quien contesta y
   * está por verificar.
   */
  marcarNumeroErrado(telefono: string, en: string): Promise<void>
}

export interface ResumenWebhook {
  estadosAplicados: number
  entrantesRegistrados: number
  optOuts: number
  numerosErrados: number
  duplicadosIgnorados: number
  /**
   * Los hilos donde entró un mensaje **nuevo**, sin repetir.
   *
   * Es lo que el llamador necesita para hacer contestar al agente. Procesar no
   * es responder: esta función registra, y quien la llama decide qué hacer con
   * lo registrado.
   *
   * **Un hilo aparece una sola vez aunque hayan entrado tres mensajes suyos.**
   * `value.messages[]` es un array: el deudor manda "hola" y enseguida "cuánto
   * debo", y las dos llegan en la misma entrega con wamid distintos, así que la
   * idempotencia no las toca y las dos caen en el mismo hilo. Responder una vez
   * por mensaje sería contestarle dos veces a quien escribió dos renglones
   * seguidos —dos turnos de modelo cobrados, y la posibilidad de dos acuerdos
   * para la misma obligación—. El turno se hace después de registrarlos todos,
   * así que el agente los ve a los dos y contesta una vez.
   */
  aResponder: Array<{
    conversacionId: string
    /**
     * El número **desde el que escribió**, que no siempre es el primero de la
     * cartera. `deudores.telefonos` es un array y el webhook matchea cualquiera
     * de ellos; responder al primero le manda las cifras de la deuda a un
     * teléfono que no escribió — que en cartera importada suele ser un familiar
     * o una referencia. Y Meta cuenta la ventana de 24 h por destinatario, así
     * que además el envío fallaría.
     */
    telefono: string
  }>
}

/**
 * Procesa un payload ya verificado.
 *
 * El orden importa: primero se registra el entrante y se abre la ventana, y
 * solo después se evalúa el opt-out. Así el mensaje que pide la baja queda en
 * el log igual — es la prueba de que la baja se pidió, y es lo que se le
 * enseña a la SIC.
 */
export async function procesarWebhook(
  payload: unknown,
  repo: RepositorioWebhook,
): Promise<ResumenWebhook> {
  const resumen: ResumenWebhook = {
    estadosAplicados: 0,
    entrantesRegistrados: 0,
    optOuts: 0,
    numerosErrados: 0,
    duplicadosIgnorados: 0,
    aResponder: [],
  }

  for (const cambio of interpretarEstados(payload)) {
    // Un mismo `wamid` recibe varios estados (sent → delivered → read), así que
    // la llave de idempotencia incluye el estado: si no, solo entraría el
    // primero y el contacto se quedaría en `enviado` para siempre.
    const llave = `estado:${cambio.idProveedor}:${cambio.estado}`
    if (await repo.yaProcesado(llave)) {
      resumen.duplicadosIgnorados += 1
      continue
    }
    await repo.actualizarEstado(cambio)
    await repo.marcarProcesado(llave)
    resumen.estadosAplicados += 1
  }

  for (const mensaje of interpretarEntrantes(payload)) {
    const llave = `entrante:${mensaje.idProveedor}`
    if (await repo.yaProcesado(llave)) {
      resumen.duplicadosIgnorados += 1
      continue
    }

    const hilo = await repo.registrarEntrante(mensaje)
    await repo.abrirVentanaServicio(mensaje.deTelefono, mensaje.ocurrioEn)

    if (detectarOptOut(mensaje.cuerpo)) {
      await repo.revocarConsentimiento(mensaje.deTelefono, mensaje.ocurrioEn)
      resumen.optOuts += 1
    }

    // Los dos pueden dispararse con el mismo mensaje —"no es mi número, no me
    // escriban más" es las dos cosas— y los dos se escriben. No compiten: uno
    // revoca la autorización y el otro abre una revisión, y el guard sabe cuál
    // explicar primero.
    if (detectarNumeroErrado(mensaje.cuerpo)) {
      await repo.marcarNumeroErrado(mensaje.deTelefono, mensaje.ocurrioEn)
      resumen.numerosErrados += 1
    }

    await repo.marcarProcesado(llave)
    resumen.entrantesRegistrados += 1
    if (hilo && !resumen.aResponder.some((h) => h.conversacionId === hilo.conversacionId)) {
      resumen.aResponder.push({ ...hilo, telefono: mensaje.deTelefono })
    }
  }

  return resumen
}

/**
 * Repositorio en memoria, para tests y para el `pnpm dev` local.
 *
 * **No sirve en producción**: se pierde al reiniciar y no se comparte entre
 * instancias, así que dos réplicas procesarían el mismo webhook dos veces. Es
 * un tapón explícito, no una implementación.
 */
export class RepositorioEnMemoria implements RepositorioWebhook {
  readonly procesados = new Set<string>()
  readonly estados: CambioEstado[] = []
  readonly entrantes: MensajeEntrante[] = []
  readonly ventanas = new Map<string, string>()
  readonly revocados = new Map<string, string>()
  readonly numerosErrados = new Map<string, string>()

  async yaProcesado(id: string): Promise<boolean> {
    return this.procesados.has(id)
  }
  async marcarProcesado(id: string): Promise<void> {
    this.procesados.add(id)
  }
  async actualizarEstado(cambio: CambioEstado): Promise<void> {
    this.estados.push(cambio)
  }
  async registrarEntrante(mensaje: MensajeEntrante): Promise<{ conversacionId: string } | null> {
    this.entrantes.push(mensaje)
    return null
  }
  async abrirVentanaServicio(telefono: string, entranteEn: string): Promise<void> {
    this.ventanas.set(telefono, entranteEn)
  }
  async revocarConsentimiento(telefono: string, en: string): Promise<void> {
    if (!this.revocados.has(telefono)) this.revocados.set(telefono, en)
  }
  async marcarNumeroErrado(telefono: string, en: string): Promise<void> {
    // Se queda con la primera vez, igual que la revocación: la fecha en que se
    // avisó es el dato, y cada mensaje posterior la reescribía hacia adelante.
    if (!this.numerosErrados.has(telefono)) this.numerosErrados.set(telefono, en)
  }
}
