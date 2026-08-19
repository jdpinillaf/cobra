import type { Acuerdo, Pago } from '@/domain/types'
import type { Conversacion } from './estado'

/**
 * La forma que viaja al navegador.
 *
 * Vive aparte de `servicio.ts` porque la pantalla la importa, y `servicio.ts`
 * arrastra el SDK del modelo y las llamadas a Chatwoot. Un `import type` se
 * borra al compilar, pero tener el tipo suelto evita que un descuido
 * —importar un valor en vez del tipo— meta el cerebro entero en el bundle.
 */
export interface VistaConversacion {
  telefono: string
  version: number
  estadoCaso: Conversacion['estadoCaso']
  mensajes: Conversacion['mensajes']
  traza: Conversacion['traza']
  expediente: {
    nombre: string
    documento: string
    numeroCredito: string
    saldoTotal: number
    saldoLegible: string
    capital: number
    interesMora: number
    diasMora: number
    tramo: string
    estadoObligacion: string
    fechaVencimiento: string
    consentimiento: { otorgado: boolean; fuente: string; revocadoEn: string | null }
    contactosPrevios: number
  }
  limites: {
    descuentoMaxPct: number
    cuotasMax: number
    diasPlazoMax: number
    montoMinimoAbono: number
  }
  acuerdo: Acuerdo | null
  pago: Pago | null
  /** Cuántos intentos de contacto se han registrado, incluidos los bloqueados. */
  auditoria: number
}
