import type { TramoMora } from '@/domain/types'

/**
 * Base de conocimiento del cliente.
 *
 * Esto es lo que en la reunión se llama "el agente consulta las políticas de tu
 * empresa": no son reglas nuestras, son las de quien contrata. Van aparte del
 * prompt a propósito — el prompt define *cómo habla* el agente y no debería
 * cambiar por cliente; esto define *qué puede decir* y cambia con cada uno.
 *
 * En producción esto sale de la configuración del cliente. Acá está escrito para
 * que la demo tenga respuestas concretas en vez de generalidades.
 *
 * Ojo con la diferencia entre esto y `LimitesNegociacion`: los límites son un
 * candado que se valida en código (`herramientas.ts`), esto es texto que el
 * modelo lee. Si se contradicen, mandan los límites.
 */

export interface Politica {
  id: string
  /** Con qué situaciones se relaciona. Se usa para recuperar solo lo pertinente. */
  temas: readonly string[]
  titulo: string
  contenido: string
}

export const POLITICAS: readonly Politica[] = [
  {
    id: 'medios-de-pago',
    temas: ['pago', 'pagar', 'link', 'medio', 'pse', 'nequi', 'tarjeta', 'consignar', 'oficina'],
    titulo: 'Medios de pago aceptados',
    contenido:
      'Se paga por el link que envía el agente (PSE, Nequi, Bancolombia, tarjeta débito o crédito), ' +
      'o presencialmente en cualquiera de las tres oficinas de Cali, de lunes a viernes de 8 a 5 y ' +
      'sábados de 9 a 1. No se reciben pagos por transferencia a cuentas personales de asesores, ' +
      'nunca. Si el deudor dice que le pidieron consignar a una cuenta personal, escalar de inmediato.',
  },
  {
    id: 'acuerdos',
    temas: ['cuotas', 'acuerdo', 'plazo', 'descuento', 'rebaja', 'partir', 'abonar'],
    titulo: 'Acuerdos de pago',
    contenido:
      'Todo acuerdo requiere un abono inicial el mismo día en que se pacta. Las cuotas se fijan cada ' +
      '15 días, no mensuales. El descuento aplica sobre intereses de mora, nunca sobre capital. ' +
      'Un acuerdo incumplido no se vuelve a ofrecer en las mismas condiciones: la segunda vez exige ' +
      'abono inicial del 40%.',
  },
  {
    id: 'disputa',
    temas: ['no debo', 'ya pagué', 'error', 'reclamo', 'disputa', 'no es mío', 'estafa'],
    titulo: 'Cuando el deudor dice que no debe',
    contenido:
      'No se discute ni se pide prueba al deudor. Se toma el reclamo, se detiene la gestión de ese ' +
      'caso y pasa al área de cartera, que tiene 5 días hábiles para responder con el soporte del ' +
      'crédito. Decirle al deudor que la gestión queda suspendida mientras se revisa.',
  },
  {
    id: 'no-soy-yo',
    temas: ['no soy', 'número equivocado', 'no conozco', 'se equivocó'],
    titulo: 'Número equivocado',
    contenido:
      'Si quien contesta dice no ser el titular, no se le da ningún dato del crédito: ni el monto, ' +
      'ni el número, ni desde cuándo. Se pide disculpas, se marca el número como errado y se cierra ' +
      'la conversación. Dar información de la deuda a un tercero es una violación de habeas data.',
  },
  {
    id: 'reporte-centrales',
    temas: ['datacrédito', 'centrales', 'reporte', 'vida crediticia', 'historial'],
    titulo: 'Reporte a centrales de riesgo',
    contenido:
      'El reporte negativo se hace a los 60 días de mora, previa comunicación al deudor con 20 días ' +
      'de anticipación como exige la ley. Al pagar, el retiro del reporte tarda hasta 30 días. ' +
      'Nunca usar el reporte como amenaza ni prometer un retiro inmediato: ambas cosas son ilegales.',
  },
  {
    id: 'situacion-dificil',
    temas: ['desempleado', 'enfermo', 'sin trabajo', 'no tengo', 'quebrado', 'no puedo'],
    titulo: 'Deudor en situación difícil',
    contenido:
      'Si el deudor manifiesta desempleo, enfermedad o calamidad, no se insiste en el pago total. ' +
      'Se ofrece el abono mínimo del tramo y se le pregunta en qué fecha concreta podría hacerlo. ' +
      'Si dice que no puede en ningún plazo, se escala: hay opciones de refinanciación que solo ' +
      'autoriza un asesor.',
  },
  {
    id: 'tono',
    temas: ['insulto', 'grosería', 'molesto', 'bravo', 'amenaza'],
    titulo: 'Si el deudor se altera',
    contenido:
      'No se responde en el mismo tono ni se corta la conversación. Se reconoce la molestia, se ' +
      'recuerda una sola vez que el objetivo es encontrar una salida, y se ofrece hablar con una ' +
      'persona. Si hay insultos repetidos o amenazas, escalar.',
  },
] as const

/**
 * Recuperación por palabras clave sobre un corpus de siete políticas.
 *
 * No hay embeddings ni índice vectorial y no hacen falta: con este tamaño, el
 * costo de un match por substring es nulo y el resultado es determinista, que
 * para una demo vale más que la sofisticación. Si el corpus crece a decenas de
 * documentos por cliente, acá es donde entra la búsqueda semántica.
 */
export function buscarPoliticas(consulta: string, maximo = 3): Politica[] {
  const texto = normalizar(consulta)
  const puntuadas = POLITICAS.map((politica) => ({
    politica,
    puntos: politica.temas.filter((tema) => texto.includes(normalizar(tema))).length,
  }))

  const conMatch = puntuadas.filter((p) => p.puntos > 0)
  if (conMatch.length === 0) return []

  return conMatch
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, maximo)
    .map((p) => p.politica)
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Cómo se le explica al deudor cada tramo. Le da al agente algo concreto que
 * decir sobre la urgencia sin recurrir a la amenaza, que es lo que hace que la
 * cobranza tradicional termine sancionada.
 */
export const CONTEXTO_POR_TRAMO: Record<TramoMora, string> = {
  preventiva: 'La cuota todavía no vence. El mensaje es un recordatorio, no un cobro.',
  temprana:
    'Mora reciente. En la mayoría de casos es olvido, no incapacidad de pago: basta con recordar y dar el medio.',
  media:
    'Mora consolidada. Acá es donde el acuerdo tiene sentido y donde se acerca el reporte a centrales a los 60 días.',
  tardia:
    'Mora avanzada. El crédito ya está reportado. El objetivo es recuperar algo, no todo.',
  castigada:
    'El saldo ya se dio por perdido contablemente. Recuperar la mitad es un buen resultado; cerrar el caso vale más que el monto.',
}
