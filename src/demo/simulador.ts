import type { Cadencia, Canal, CategoriaPlantilla, Contacto, Deudor, Obligacion, TramoMora } from '@/domain/types'
import type { MotivoBloqueo } from '@/compliance/guard'
import { desdeBogota, enBogota, sumarDias } from '@/compliance/reloj-bogota'
import { pasosVencidos, planificarEnvio } from '@/cadence/planificador'
import { tarifaDe } from '@/channels/provider'
import { mulberry32, type CarteraDemo } from './seed'

/**
 * Simulador de la demo de venta.
 *
 * Corre la cadencia sobre una cartera ficticia con reloj acelerado y produce
 * las tres cosas que cierran una venta: cuánto se recupera, cuánto cuesta, y la
 * prueba de que ningún mensaje violó la Ley 2300.
 *
 * La mitad de la cartera queda como **grupo de control** sin contactar. Sin
 * control no hay forma honesta de decir cuánto aportó el agente: los deudores
 * de mora temprana pagan solos en buena proporción, y atribuirse eso completo
 * sería inflar el resultado.
 */

/**
 * Probabilidad de pago en 30 días sin ninguna gestión, por tramo. Es la línea
 * base contra la que se mide el agente.
 */
const RECUPERACION_BASE: Record<TramoMora, number> = {
  preventiva: 0.82,
  temprana: 0.34,
  media: 0.14,
  tardia: 0.05,
  castigada: 0.015,
}

/**
 * Multiplicador de la probabilidad diaria durante los 3 días siguientes a un
 * mensaje entregado. El efecto es fuerte en mora temprana, donde suele bastar
 * con recordar, y débil en castigada, donde el problema no es el olvido.
 */
const IMPULSO_POR_CONTACTO: Record<TramoMora, number> = {
  preventiva: 1.6,
  temprana: 4.5,
  media: 3.8,
  tardia: 2.4,
  castigada: 1.8,
}

const DIAS_DE_EFECTO = 3

export interface ResultadoGrupo {
  obligaciones: number
  saldoInicialCop: number
  pagadas: number
  recuperadoCop: number
  tasaRecuperacion: number
}

export interface ResultadoSimulacion {
  diasSimulados: number
  fechaInicio: string
  fechaFin: string
  tratamiento: ResultadoGrupo
  control: ResultadoGrupo
  /** Diferencia en puntos porcentuales entre tratamiento y control. */
  upliftPuntos: number
  mensajes: { whatsapp: number; sms: number; total: number; costoCop: number }
  /**
   * Anexo de compliance, en dos categorías que no significan lo mismo:
   * `diferidos` salieron más tarde para respetar la ventana legal;
   * `bloqueados` no salieron nunca, por falta de autorización o por estado de
   * la obligación.
   */
  diferidos: Partial<Record<MotivoBloqueo, number>>
  bloqueados: Partial<Record<MotivoBloqueo, number>>
  diferidosTotales: number
  bloqueadosTotales: number
  contactos: Contacto[]
}

export interface OpcionesSimulacion {
  cartera: CarteraDemo
  fechaInicio: string
  dias: number
  semilla?: number
  /** Fracción de la cartera que queda sin contactar. */
  fraccionControl?: number
  /** Hora de Bogotá a la que corre el batch diario. */
  horaDelBatch?: number
}

interface EstadoObligacionSim {
  obligacion: Obligacion
  deudor: Deudor
  enTratamiento: boolean
  pasosEjecutados: Set<number>
  ultimoContactoEntregado: string | null
  pagadaEn: string | null
  /**
   * Fecha a partir de la cual tiene sentido volver a intentar. El planificador
   * la fija cuando difiere un envío, para no reintentar —y no volver a
   * registrar el mismo bloqueo— todos los días.
   */
  reintentarDesde: string | null
  /** La cadencia de este deudor se detuvo definitivamente (opt-out, pago, etc.). */
  detenida: boolean
}

export function simular(opciones: OpcionesSimulacion): ResultadoSimulacion {
  const { cartera, fechaInicio, dias } = opciones
  const fraccionControl = opciones.fraccionControl ?? 0.5
  const horaDelBatch = opciones.horaDelBatch ?? 9
  const rnd = mulberry32(opciones.semilla ?? 7)

  const deudoresPorId = new Map(cartera.deudores.map((d) => [d.id, d]))
  const cadenciaPorTramo = new Map<TramoMora, Cadencia>(
    cartera.cadencias.map((c) => [c.tramo, c]),
  )
  /**
   * La categoría manda sobre el precio, no el canal: una `marketing` cuesta
   * unas 25 veces una `utility`. Simular todo a una tarifa plana escondería
   * justo el error que el modelo de negocio advierte —meter una promoción en
   * una plantilla utility y que Meta la reclasifique.
   */
  const categoriaPorPlantilla = new Map<string, CategoriaPlantilla>(
    cartera.plantillas.map((p) => [p.id, p.categoria]),
  )

  const estados: EstadoObligacionSim[] = cartera.obligaciones
    .map((obligacion): EstadoObligacionSim | null => {
      const deudor = deudoresPorId.get(obligacion.deudorId)
      if (!deudor) return null
      return {
        obligacion,
        deudor,
        enTratamiento: rnd() >= fraccionControl,
        pasosEjecutados: new Set<number>(),
        ultimoContactoEntregado: null,
        pagadaEn: null,
        reintentarDesde: null,
        detenida: false,
      }
    })
    .filter((e): e is EstadoObligacionSim => e !== null)

  const contactos: Contacto[] = []
  const contactosPorDeudor = new Map<string, Contacto[]>()
  const diferidos: Partial<Record<MotivoBloqueo, number>> = {}
  const bloqueados: Partial<Record<MotivoBloqueo, number>> = {}
  const fechaFinSim = sumarDias(fechaInicio, dias - 1)
  let secuencia = 0

  for (let dia = 0; dia < dias; dia++) {
    const fecha = sumarDias(fechaInicio, dia)
    const instante = desdeBogota(fecha, horaDelBatch)

    for (const estado of estados) {
      if (estado.pagadaEn) continue

      if (estado.enTratamiento) {
        intentarContacto(estado, fecha, instante)
      }

      // El pago se sortea después del contacto del día, para que un mensaje
      // entregado hoy pueda influir en el pago de hoy mismo.
      if (sortearPago(estado, fecha, rnd)) {
        estado.pagadaEn = fecha
        estado.obligacion = { ...estado.obligacion, estado: 'pagada' }
      }
    }
  }

  /**
   * Un intento por decisión, no uno por día.
   *
   * Cuando el planificador difiere un envío, el simulador lo trata como lo
   * trataría un scheduler real: encola el job para la ventana válida que le
   * indicó y lo ejecuta ahí, en vez de volver a intentar cada mañana. Sin eso
   * el log se llenaría del mismo rechazo repetido y sería ilegible ante la SIC.
   *
   * Un diferimiento y un bloqueo son cosas distintas y se contabilizan aparte:
   * el diferido sale más tarde, el bloqueado no sale nunca.
   */
  function intentarContacto(estado: EstadoObligacionSim, fecha: string, instante: Date): void {
    if (estado.detenida) return
    if (estado.reintentarDesde && fecha < estado.reintentarDesde) return

    const cadencia = cadenciaPorTramo.get(estado.obligacion.tramo)
    if (!cadencia) return

    const vencidos = pasosVencidos(estado.obligacion, cadencia, fecha, estado.pasosEjecutados)
    const siguiente = vencidos[0]
    if (!siguiente) return

    const canal: Canal = siguiente.paso.canal
    const historial = contactosPorDeudor.get(estado.deudor.id) ?? []
    const plan = planificarEnvio(
      {
        canal,
        deudor: estado.deudor,
        obligacion: estado.obligacion,
        contactosDelDeudor: historial,
      },
      instante,
    )

    if (plan.tipo === 'detener') {
      estado.detenida = true
      bloqueados[plan.motivo] = (bloqueados[plan.motivo] ?? 0) + 1
      secuencia += 1
      registrar(estado, {
        id: `ctc_${secuencia}`,
        canal,
        timestamp: instante.toISOString(),
        plantillaId: siguiente.paso.plantillaId,
        resultado: 'bloqueado',
        motivoBloqueo: `${plan.motivo}: ${plan.detalle}`,
        costoCop: 0,
      })
      return
    }

    let instanteEnvio = instante
    if (plan.tipo === 'reprogramar') {
      const fechaProgramada = enBogota(plan.instante).fecha
      diferidos[plan.motivoDeEspera] = (diferidos[plan.motivoDeEspera] ?? 0) + 1

      // Si la ventana cae más allá del horizonte simulado, el envío queda
      // pendiente y no se cuenta como entregado.
      if (fechaProgramada > fechaFinSim) {
        estado.reintentarDesde = fechaProgramada
        return
      }
      instanteEnvio = plan.instante
    }

    estado.pasosEjecutados.add(siguiente.indice)
    estado.ultimoContactoEntregado = enBogota(instanteEnvio).fecha
    estado.reintentarDesde = null
    secuencia += 1
    registrar(estado, {
      id: `ctc_${secuencia}`,
      canal,
      timestamp: instanteEnvio.toISOString(),
      plantillaId: siguiente.paso.plantillaId,
      resultado: 'entregado',
      motivoBloqueo: null,
      costoCop: tarifaDe(canal).costoCop(
        canal,
        categoriaPorPlantilla.get(siguiente.paso.plantillaId) ?? 'utility',
      ),
    })
  }

  function registrar(
    estado: EstadoObligacionSim,
    parcial: Pick<
      Contacto,
      'id' | 'canal' | 'timestamp' | 'plantillaId' | 'resultado' | 'motivoBloqueo' | 'costoCop'
    >,
  ): void {
    const contacto: Contacto = {
      ...parcial,
      clienteId: cartera.cliente.id,
      obligacionId: estado.obligacion.id,
      deudorId: estado.deudor.id,
      direccion: 'saliente',
      cuerpo: '',
      // La simulación no llama a ningún proveedor: no hay wamid que guardar.
      idProveedor: null,
      proveedor: null,
    }
    contactos.push(contacto)
    const previos = contactosPorDeudor.get(estado.deudor.id) ?? []
    previos.push(contacto)
    contactosPorDeudor.set(estado.deudor.id, previos)
  }

  return construirResultado({
    estados,
    contactos,
    diferidos,
    bloqueados,
    fechaInicio,
    dias,
  })
}

/**
 * Convierte una probabilidad a 30 días en una probabilidad diaria equivalente,
 * para que la simulación día a día reproduzca la tasa mensual esperada.
 */
function probabilidadDiaria(mensual: number): number {
  return 1 - Math.pow(1 - mensual, 1 / 30)
}

function sortearPago(estado: EstadoObligacionSim, fecha: string, rnd: () => number): boolean {
  const tramo = estado.obligacion.tramo
  let p = probabilidadDiaria(RECUPERACION_BASE[tramo])

  if (estado.ultimoContactoEntregado) {
    const diasDesde =
      (new Date(`${fecha}T00:00:00Z`).getTime() -
        new Date(`${estado.ultimoContactoEntregado}T00:00:00Z`).getTime()) /
      86_400_000
    if (diasDesde >= 0 && diasDesde < DIAS_DE_EFECTO) {
      p *= IMPULSO_POR_CONTACTO[tramo]
    }
  }

  return rnd() < Math.min(p, 1)
}

function construirResultado(params: {
  estados: EstadoObligacionSim[]
  contactos: Contacto[]
  diferidos: Partial<Record<MotivoBloqueo, number>>
  bloqueados: Partial<Record<MotivoBloqueo, number>>
  fechaInicio: string
  dias: number
}): ResultadoSimulacion {
  const { estados, contactos, diferidos, bloqueados, fechaInicio, dias } = params
  const sumar = (r: Partial<Record<MotivoBloqueo, number>>) =>
    Object.values(r).reduce((s, n) => s + (n ?? 0), 0)

  const resumir = (grupo: EstadoObligacionSim[]): ResultadoGrupo => {
    const saldoInicialCop = grupo.reduce((s, e) => s + e.obligacion.saldoTotal, 0)
    const pagadas = grupo.filter((e) => e.pagadaEn !== null)
    const recuperadoCop = pagadas.reduce((s, e) => s + e.obligacion.saldoTotal, 0)
    return {
      obligaciones: grupo.length,
      saldoInicialCop,
      pagadas: pagadas.length,
      recuperadoCop,
      tasaRecuperacion: saldoInicialCop === 0 ? 0 : recuperadoCop / saldoInicialCop,
    }
  }

  const tratamiento = resumir(estados.filter((e) => e.enTratamiento))
  const control = resumir(estados.filter((e) => !e.enTratamiento))

  const entregados = contactos.filter((c) => c.resultado !== 'bloqueado')
  const whatsapp = entregados.filter((c) => c.canal === 'whatsapp').length
  const sms = entregados.filter((c) => c.canal === 'sms').length

  return {
    diasSimulados: dias,
    fechaInicio,
    fechaFin: sumarDias(fechaInicio, dias - 1),
    tratamiento,
    control,
    upliftPuntos: (tratamiento.tasaRecuperacion - control.tasaRecuperacion) * 100,
    mensajes: {
      whatsapp,
      sms,
      total: entregados.length,
      costoCop: entregados.reduce((s, c) => s + c.costoCop, 0),
    },
    diferidos,
    bloqueados,
    diferidosTotales: sumar(diferidos),
    bloqueadosTotales: sumar(bloqueados),
    contactos,
  }
}
