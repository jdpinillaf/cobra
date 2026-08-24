import type { Deudor, Obligacion, TipoDocumento } from '@/domain/types'
import { calcularTramo } from '@/cadence/planificador'
import {
  calcularDiasMora,
  normalizarCelular,
  normalizarDocumento,
  normalizarFecha,
  normalizarMonto,
} from './normalizar'

/**
 * Mapeo de columnas del archivo del cliente al esquema canónico.
 *
 * Se guarda por cliente: la primera carga cuesta cinco minutos de mapeo manual
 * y las siguientes son un clic. Es la diferencia entre un onboarding y una
 * tarea recurrente para el gestor.
 */
export interface MapeoColumnas {
  documento: string
  nombre: string
  telefono: string
  saldoTotal: string
  fechaVencimiento: string
  numeroCredito?: string
  capital?: string
  interesMora?: string
  tipoDocumento?: string
  telefonoAlterno?: string
  email?: string
}

/** Campos sin los cuales no se puede cobrar nada. */
export const CAMPOS_OBLIGATORIOS = [
  'documento',
  'nombre',
  'telefono',
  'saldoTotal',
  'fechaVencimiento',
] as const satisfies ReadonlyArray<keyof MapeoColumnas>

/**
 * Sinónimos observados en bases de prestamistas colombianos. El orden importa:
 * gana el primero que haga match, así que los términos más específicos van
 * antes que los genéricos.
 */
const SINONIMOS: Record<keyof MapeoColumnas, string[]> = {
  documento: ['cedula', 'cédula', 'documento', 'nrodocumento', 'numerodocumento', 'cc', 'identificacion', 'nit', 'doc'],
  tipoDocumento: ['tipodocumento', 'tipodoc', 'tipoid'],
  nombre: ['nombrecompleto', 'nombrecliente', 'nombredeudor', 'nombre', 'cliente', 'deudor', 'titular'],
  telefono: ['celular', 'movil', 'móvil', 'whatsapp', 'telefonocelular', 'telefono', 'teléfono', 'contacto', 'tel'],
  telefonoAlterno: ['celular2', 'telefono2', 'teléfono2', 'telefonoalterno', 'otrotelefono'],
  email: ['email', 'correo', 'correoelectronico', 'mail'],
  numeroCredito: ['numerocredito', 'nrocredito', 'credito', 'obligacion', 'obligación', 'pagare', 'pagaré', 'contrato', 'referencia'],
  saldoTotal: ['saldototal', 'saldo', 'totaladeudado', 'deudatotal', 'valortotal', 'saldocapitalinteres', 'total'],
  capital: ['capital', 'saldocapital', 'valorcapital'],
  interesMora: ['interesmora', 'interesesmora', 'moratorios', 'interesdemora'],
  fechaVencimiento: ['fechavencimiento', 'fechavence', 'vencimiento', 'fechapago', 'fechalimite', 'vence'],
}

const normalizarEncabezado = (h: string) =>
  h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * Adivina el mapeo a partir de los encabezados. Es una ayuda, no una autoridad:
 * la UI muestra lo detectado para que un humano lo confirme antes de cargar.
 */
export function detectarMapeo(encabezados: string[]): Partial<MapeoColumnas> {
  const normalizados = encabezados.map((h) => ({ original: h, clave: normalizarEncabezado(h) }))
  const mapeo: Partial<MapeoColumnas> = {}
  const usados = new Set<string>()

  for (const [campo, sinonimos] of Object.entries(SINONIMOS) as [keyof MapeoColumnas, string[]][]) {
    // Primero coincidencia exacta; si no, que el encabezado empiece por el sinónimo.
    const exacta = normalizados.find((n) => !usados.has(n.original) && sinonimos.includes(n.clave))
    const parcial =
      exacta ??
      normalizados.find((n) => !usados.has(n.original) && sinonimos.some((s) => n.clave.startsWith(s)))
    if (parcial) {
      mapeo[campo] = parcial.original
      usados.add(parcial.original)
    }
  }

  return mapeo
}

export function faltantes(mapeo: Partial<MapeoColumnas>): string[] {
  return CAMPOS_OBLIGATORIOS.filter((c) => !mapeo[c])
}

export type Fila = Record<string, unknown>

export interface FilaEnCuarentena {
  numeroFila: number
  errores: string[]
  fila: Fila
}

export interface ResultadoIngesta {
  deudores: Deudor[]
  obligaciones: Obligacion[]
  cuarentena: FilaEnCuarentena[]
  /** Deudores fusionados por documento repetido en el archivo. */
  duplicadosFusionados: number
}

const TIPOS_DOC: Record<string, TipoDocumento> = {
  cc: 'CC', ce: 'CE', nit: 'NIT', ti: 'TI', pa: 'PA', pasaporte: 'PA', pep: 'PEP',
}

/**
 * Convierte filas crudas al modelo canónico.
 *
 * Una fila inválida va a cuarentena con el detalle de qué falló; nunca tumba la
 * carga. Un archivo de 8.000 registros con 30 teléfonos malos tiene que cargar
 * 7.970 y reportar los 30, no fallar entero.
 */
export function normalizarFilas(
  filas: Fila[],
  mapeo: MapeoColumnas,
  opciones: { clienteId: string; fechaCorte: string },
): ResultadoIngesta {
  const { clienteId, fechaCorte } = opciones
  const deudoresPorDocumento = new Map<string, Deudor>()
  const obligaciones: Obligacion[] = []
  const cuarentena: FilaEnCuarentena[] = []
  let duplicadosFusionados = 0

  filas.forEach((fila, indice) => {
    const numeroFila = indice + 2 // +1 por índice base 1, +1 por la fila de encabezados
    const errores: string[] = []

    const doc = normalizarDocumento(fila[mapeo.documento])
    if (!doc.ok) errores.push(`documento: ${doc.error}`)

    const nombre = String(fila[mapeo.nombre] ?? '').trim()
    if (nombre === '') errores.push('nombre: vacío')

    const tel = normalizarCelular(fila[mapeo.telefono])
    const telAlterno = mapeo.telefonoAlterno ? normalizarCelular(fila[mapeo.telefonoAlterno]) : null
    if (!tel.ok && !telAlterno?.ok) {
      errores.push(`teléfono: ${tel.error}`)
    }

    const saldo = normalizarMonto(fila[mapeo.saldoTotal])
    if (!saldo.ok) errores.push(`saldo: ${saldo.error}`)
    else if (saldo.valor <= 0) errores.push('saldo: no hay nada que cobrar')

    const vencimiento = normalizarFecha(fila[mapeo.fechaVencimiento])
    if (!vencimiento.ok) errores.push(`vencimiento: ${vencimiento.error}`)

    if (errores.length > 0 || !doc.ok || !saldo.ok || !vencimiento.ok) {
      cuarentena.push({ numeroFila, errores, fila })
      return
    }

    const telefonos = [tel.ok ? tel.valor : null, telAlterno?.ok ? telAlterno.valor : null].filter(
      (t): t is string => t !== null,
    )

    const existente = deudoresPorDocumento.get(doc.valor)
    if (existente) {
      duplicadosFusionados += 1
      for (const t of telefonos) if (!existente.telefonos.includes(t)) existente.telefonos.push(t)
    } else {
      const tipoCrudo = mapeo.tipoDocumento
        ? normalizarEncabezado(String(fila[mapeo.tipoDocumento] ?? ''))
        : ''
      deudoresPorDocumento.set(doc.valor, {
        id: `deu_${doc.valor}`,
        clienteId,
        tipoDocumento: TIPOS_DOC[tipoCrudo] ?? 'CC',
        documento: doc.valor,
        nombre,
        telefonos,
        email: mapeo.email ? (String(fila[mapeo.email] ?? '').trim() || null) : null,
        rol: 'titular',
        /**
         * El consentimiento se marca como otorgado con fuente `importado`: la
         * base viene de créditos con pagaré firmado. Queda registrado como tal
         * para que la auditoría distinga un opt-in explícito de uno heredado.
         */
        consentimiento: { otorgado: true, fuente: 'importado', fecha: fechaCorte, revocadoEn: null },
        preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
        // La cartera que se importa no trae esto: lo escribe el webhook cuando
        // alguien contesta que el número no es del deudor.
        numeroErradoEn: null,
      })
    }

    const capital = mapeo.capital ? normalizarMonto(fila[mapeo.capital]) : null
    const interes = mapeo.interesMora ? normalizarMonto(fila[mapeo.interesMora]) : null
    const diasMora = calcularDiasMora(vencimiento.valor, fechaCorte)
    const numeroCredito = mapeo.numeroCredito
      ? String(fila[mapeo.numeroCredito] ?? '').trim() || `${doc.valor}-${numeroFila}`
      : `${doc.valor}-${numeroFila}`

    obligaciones.push({
      id: `obl_${doc.valor}_${numeroFila}`,
      clienteId,
      deudorId: `deu_${doc.valor}`,
      numeroCredito,
      capital: capital?.ok ? capital.valor : saldo.valor,
      interesMora: interes?.ok ? interes.valor : 0,
      saldoTotal: saldo.valor,
      fechaVencimiento: vencimiento.valor,
      diasMora,
      tramo: calcularTramo(diasMora),
      estado: diasMora > 0 ? 'en_mora' : 'al_dia',
    })
  })

  return {
    deudores: [...deudoresPorDocumento.values()],
    obligaciones,
    cuarentena,
    duplicadosFusionados,
  }
}
