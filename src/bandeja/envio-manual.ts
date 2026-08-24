import { categoriaDelEnvio, estaAbierta } from '@/channels/ventana-servicio'
import type { CategoriaFacturable } from '@/channels/tarifas'
import type { VentanaServicio } from '@/domain/types'

/**
 * Qué puede escribir un asesor, y cuándo.
 *
 * WhatsApp solo acepta texto libre dentro de las 24 h que abre un mensaje del
 * deudor. Fuera de esa ventana exige plantilla aprobada, y el texto libre se
 * rechaza con el error 131047: el mensaje que el asesor creyó haber mandado no
 * llega nunca.
 *
 * **La decisión vive del lado del servidor.** La interfaz bloquea el textarea
 * por comodidad, para que la persona vea la regla en vez de chocarse con ella;
 * esto la bloquea de verdad. Si la regla viviera solo en el navegador,
 * cualquier request directo la saltearía y el mensaje se perdería igual.
 */

/** Tope de WhatsApp para el cuerpo de un mensaje de texto. */
const LARGO_MAXIMO = 4096

export interface PlantillaParaEnviar {
  id: string
  /** Nombre tal como quedó aprobado en Meta. Sin él no se puede enviar. */
  nombreMeta: string | null
  categoria: CategoriaFacturable
  aprobada: boolean
  variables: string[]
}

export type MotivoRechazo =
  | 'requiere_plantilla'
  | 'plantilla_no_aprobada'
  | 'faltan_variables'
  | 'texto_vacio'
  | 'texto_muy_largo'

export type DecisionEnvio =
  | { ok: true; categoria: CategoriaFacturable; conPlantilla: boolean }
  | { ok: false; motivo: MotivoRechazo; detalle: string; expiroEn?: string }

export function decidirEnvioManual(params: {
  ventana: VentanaServicio | null
  ahora: Date
  plantilla: PlantillaParaEnviar | null
  texto: string | null
  variables?: string[]
}): DecisionEnvio {
  const { ventana, ahora, plantilla } = params

  if (plantilla) {
    if (!plantilla.aprobada || !plantilla.nombreMeta) {
      return {
        ok: false,
        motivo: 'plantilla_no_aprobada',
        detalle: 'Meta todavía no aprobó esta plantilla, así que no se puede enviar.',
      }
    }

    const variables = params.variables ?? []
    if (variables.length !== plantilla.variables.length) {
      // Mandarla incompleta hace que Meta la rechace o, peor, que llegue con un
      // hueco justo donde iba el monto.
      return {
        ok: false,
        motivo: 'faltan_variables',
        detalle: `La plantilla necesita ${plantilla.variables.length} dato(s) y llegaron ${variables.length}.`,
      }
    }

    return {
      ok: true,
      conPlantilla: true,
      categoria: categoriaDelEnvio({ ventana, ahora, categoriaDePlantilla: plantilla.categoria }),
    }
  }

  const texto = params.texto ?? ''
  if (texto.trim() === '') {
    return { ok: false, motivo: 'texto_vacio', detalle: 'El mensaje está vacío.' }
  }
  if (texto.length > LARGO_MAXIMO) {
    return {
      ok: false,
      motivo: 'texto_muy_largo',
      detalle: `WhatsApp acepta hasta ${LARGO_MAXIMO} caracteres y llegaron ${texto.length}.`,
    }
  }

  if (!estaAbierta(ventana, ahora)) {
    return {
      ok: false,
      motivo: 'requiere_plantilla',
      detalle: ventana
        ? 'La ventana de 24 horas se cerró. Desde acá solo se puede enviar una plantilla aprobada.'
        : 'Este deudor todavía no escribió, así que no hay ventana abierta. Solo se puede enviar una plantilla aprobada.',
      expiroEn: ventana?.expiraEn,
    }
  }

  return { ok: true, conPlantilla: false, categoria: 'servicio' }
}
