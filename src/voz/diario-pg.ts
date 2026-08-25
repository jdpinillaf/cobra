/**
 * El diario de la llamada, contra Postgres.
 *
 * Envuelve el repositorio para que `abrirPuente` no sepa que existe una base:
 * el puente escribe contra una interfaz de cuatro métodos y el test le pasa un
 * array. Es el mismo reparto que `PuertoAgente`.
 */
import type { Db } from '@/repo/db'
import { costoDeLlamadaCop } from '@/channels/tarifas'
import {
  anotarAccion,
  anotarTurno,
  cerrarLlamada,
  marcarInterrumpido,
} from '@/repo/cobranza/llamadas'
import type { AccionEjecutada } from './funciones'
import type { TurnoVoz } from './agente'
import type { DiarioDeLlamada } from './puente'
import type { ResumenLlamada } from './resumen'

export class DiarioPostgres implements DiarioDeLlamada {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
    private readonly llamadaId: string,
    private readonly opciones: { grabada?: boolean } = {},
  ) {}

  async anotarTurno(turno: TurnoVoz & { indice: number }): Promise<void> {
    await anotarTurno(this.db, this.tenantId, this.llamadaId, turno)
  }

  async marcarInterrumpido(indice: number): Promise<void> {
    await marcarInterrumpido(this.db, this.tenantId, this.llamadaId, indice)
  }

  async anotarAccion(accion: AccionEjecutada & { turnoIndice: number }): Promise<void> {
    await anotarAccion(this.db, this.tenantId, this.llamadaId, accion)
  }

  async cerrar(cierre: {
    motivo: string
    duracionSeg: number
    resumen: ResumenLlamada
  }): Promise<void> {
    const costo = costoDeLlamadaCop(cierre.duracionSeg, { grabada: this.opciones.grabada })

    await cerrarLlamada(this.db, this.tenantId, this.llamadaId, {
      motivoFin: cierre.motivo,
      // El buzón se distingue de una llamada normal porque es la que hay que
      // mirar cuando el costo por conversación útil se dispara.
      estado: cierre.motivo === 'buzon' ? 'buzon' : 'finalizada',
      duracionSeg: cierre.duracionSeg,
      resumen: cierre.resumen.texto,
      resultado: cierre.resumen.resultado,
      costoTelefoniaCop: costo.telefoniaCop,
      costoIaCop: costo.iaCop,
    })
  }
}
