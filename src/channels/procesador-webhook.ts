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
  /** Registra el entrante como `Contacto` con `direccion: 'entrante'`. */
  registrarEntrante(mensaje: MensajeEntrante): Promise<void>
  /** Abre o renueva la ventana de servicio de 24 h del deudor. */
  abrirVentanaServicio(telefono: string, entranteEn: string): Promise<void>
  /** Escribe `Consentimiento.revocadoEn`. El guard ya lo respeta. */
  revocarConsentimiento(telefono: string, en: string): Promise<void>
}

export interface ResumenWebhook {
  estadosAplicados: number
  entrantesRegistrados: number
  optOuts: number
  duplicadosIgnorados: number
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
    duplicadosIgnorados: 0,
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

    await repo.registrarEntrante(mensaje)
    await repo.abrirVentanaServicio(mensaje.deTelefono, mensaje.ocurrioEn)

    if (detectarOptOut(mensaje.cuerpo)) {
      await repo.revocarConsentimiento(mensaje.deTelefono, mensaje.ocurrioEn)
      resumen.optOuts += 1
    }

    await repo.marcarProcesado(llave)
    resumen.entrantesRegistrados += 1
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

  async yaProcesado(id: string): Promise<boolean> {
    return this.procesados.has(id)
  }
  async marcarProcesado(id: string): Promise<void> {
    this.procesados.add(id)
  }
  async actualizarEstado(cambio: CambioEstado): Promise<void> {
    this.estados.push(cambio)
  }
  async registrarEntrante(mensaje: MensajeEntrante): Promise<void> {
    this.entrantes.push(mensaje)
  }
  async abrirVentanaServicio(telefono: string, entranteEn: string): Promise<void> {
    this.ventanas.set(telefono, entranteEn)
  }
  async revocarConsentimiento(telefono: string, en: string): Promise<void> {
    if (!this.revocados.has(telefono)) this.revocados.set(telefono, en)
  }
}
