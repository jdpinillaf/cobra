/**
 * Los flujos de los cuatro agentes, como diagramas.
 *
 * Cada uno arranca con **lo que llega de afuera** —el mensaje de una persona o
 * un documento— porque es lo que dispara el trabajo. Un diagrama que empieza en
 * "el agente hace X" no cuenta de dónde salió X.
 *
 * Las coordenadas están escritas a mano, no calculadas. Cuatro diagramas de
 * seis o siete pasos se dibujan mejor a ojo que con un algoritmo de layout, y
 * así cada uno se ve intencional en vez de acomodado.
 */

export type TipoPaso = 'inicio' | 'paso' | 'decision' | 'fin'

export interface Paso {
  readonly id: string
  /** Una o dos líneas cortas: el SVG no envuelve texto solo. */
  readonly titulo: readonly string[]
  /** Se muestra debajo del diagrama cuando el paso está activo. Una línea. */
  readonly detalle: string
  readonly tipo: TipoPaso
  /** Rótulo pequeño encima de la caja. Solo el nodo de entrada lo usa. */
  readonly etiqueta?: string
  /**
   * Los pasos de la rama alterna no entran en la secuencia de "siguiente
   * paso": son la salida cuando la decisión da no. Se llega a ellos con clic.
   */
  readonly alterna?: true
  readonly x: number
  readonly y: number
  readonly ancho: number
  readonly alto: number
}

export interface Arista {
  readonly de: string
  readonly a: string
  /** "sí" / "no" en las salidas de una decisión. */
  readonly etiqueta?: string
}

export interface Flujo {
  readonly id: 'cobranza' | 'datos' | 'soporte' | 'backoffice'
  readonly nombre: string
  readonly linea: string
  readonly pasos: readonly Paso[]
  readonly aristas: readonly Arista[]
  readonly ancho: number
  readonly alto: number
}

const ALTO_CAJA = 48
const ALTO_ENTRADA = 72
const ALTO_DECISION = 72

const cobranza: Flujo = {
  id: 'cobranza',
  nombre: 'Cobranza',
  linea: 'Recupera cartera, negocia dentro de tus rangos y cobra contra tu propia pasarela.',
  ancho: 1170,
  alto: 290,
  pasos: [
    {
      id: 'entra',
      tipo: 'inicio',
      etiqueta: 'Mensaje del deudor',
      titulo: ['«No tengo cómo pagar', 'todo de una»'],
      detalle:
        'Entra al número de tu empresa. Es la respuesta al recordatorio, y es donde arranca la negociación.',
      x: 10,
      y: 105,
      ancho: 200,
      alto: ALTO_ENTRADA,
    },
    {
      id: 'identifica',
      tipo: 'paso',
      titulo: ['Identifica la', 'obligación'],
      detalle: 'Cruza el número con tu cartera: saldo, días de mora y qué se le prometió antes.',
      x: 250,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'decide',
      tipo: 'decision',
      titulo: ['¿Cabe en tus', 'rangos?'],
      detalle: 'Hasta las cuotas y el descuento que tú fijaste. Fuera de ahí no negocia.',
      x: 440,
      y: 105,
      ancho: 150,
      alto: ALTO_DECISION,
    },
    {
      id: 'propone',
      tipo: 'paso',
      titulo: ['Propone el', 'acuerdo'],
      detalle: 'Dos cuotas, sin recargo, con fechas concretas. Espera confirmación antes de seguir.',
      x: 630,
      y: 15,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'link',
      tipo: 'paso',
      titulo: ['Genera el link', 'de pago'],
      detalle:
        'Contra tu propia pasarela y con referencia propia. La plata nunca pasa por nosotros.',
      x: 820,
      y: 15,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'cierra',
      tipo: 'fin',
      titulo: ['Concilia y', 'cierra'],
      detalle: 'El pago confirma solo, la cadencia se detiene y queda el registro de cada decisión.',
      x: 1010,
      y: 105,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'escala',
      tipo: 'fin',
      alterna: true,
      titulo: ['Escala a una', 'persona'],
      detalle: 'Si piden algo fuera de tus límites, pasa el caso con el hilo completo. No improvisa.',
      x: 630,
      y: 210,
      ancho: 170,
      alto: ALTO_CAJA,
    },
  ],
  aristas: [
    { de: 'entra', a: 'identifica' },
    { de: 'identifica', a: 'decide' },
    { de: 'decide', a: 'propone', etiqueta: 'sí' },
    { de: 'propone', a: 'link' },
    { de: 'link', a: 'cierra' },
    { de: 'decide', a: 'escala', etiqueta: 'no' },
  ],
}

const datos: Flujo = {
  id: 'datos',
  nombre: 'Datos',
  linea: 'Ingiere Excel, ERP o CRM y responde preguntas de negocio sobre eso.',
  ancho: 1170,
  alto: 290,
  pasos: [
    {
      id: 'entra',
      tipo: 'inicio',
      etiqueta: 'Pregunta de tu equipo',
      titulo: ['«¿Cuánto vendimos en', 'Medellín el mes pasado?»'],
      detalle: 'Llega por WhatsApp o por el canal interno que ya usen. Sin abrir un tablero.',
      x: 10,
      y: 105,
      ancho: 220,
      alto: ALTO_ENTRADA,
    },
    {
      id: 'traduce',
      tipo: 'paso',
      titulo: ['Traduce a', 'consulta'],
      detalle: 'Convierte la pregunta en algo concreto: qué fuente, qué periodo y qué filtro.',
      x: 270,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'lee',
      tipo: 'paso',
      titulo: ['Lee tus', 'fuentes'],
      detalle: 'Excel, ERP o CRM. Se conecta a lo que ya tienes; no te pide migrar nada.',
      x: 460,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'decide',
      tipo: 'decision',
      titulo: ['¿Los datos', 'alcanzan?'],
      detalle: 'Revisa si lo que hay responde la pregunta completa o solo una parte.',
      x: 650,
      y: 105,
      ancho: 150,
      alto: ALTO_DECISION,
    },
    {
      id: 'responde',
      tipo: 'paso',
      titulo: ['Responde con', 'el número'],
      detalle: 'Y con de dónde salió: fuente, corte y filtros. Una cifra sin origen no sirve.',
      x: 840,
      y: 15,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'guarda',
      tipo: 'fin',
      titulo: ['Deja la consulta', 'guardada'],
      detalle: 'La próxima vez que alguien pregunte lo mismo, ya está resuelta.',
      x: 1010,
      y: 105,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'falta',
      tipo: 'fin',
      alterna: true,
      titulo: ['Dice qué falta'],
      detalle: 'No completa con lo que parece. Dice qué dato falta y dónde debería estar.',
      x: 840,
      y: 210,
      ancho: 160,
      alto: ALTO_CAJA,
    },
  ],
  aristas: [
    { de: 'entra', a: 'traduce' },
    { de: 'traduce', a: 'lee' },
    { de: 'lee', a: 'decide' },
    { de: 'decide', a: 'responde', etiqueta: 'sí' },
    { de: 'responde', a: 'guarda' },
    { de: 'decide', a: 'falta', etiqueta: 'no' },
  ],
}

const soporte: Flujo = {
  id: 'soporte',
  nombre: 'Soporte',
  linea: 'Atiende post-venta y escala a una persona cuando se sale de lo que sabe.',
  ancho: 960,
  alto: 290,
  pasos: [
    {
      id: 'entra',
      tipo: 'inicio',
      etiqueta: 'Mensaje de tu cliente',
      titulo: ['«Mi pedido', 'no llegó»'],
      detalle: 'Entra por el canal que ya usas para atender, a la hora que sea.',
      x: 10,
      y: 105,
      ancho: 170,
      alto: ALTO_ENTRADA,
    },
    {
      id: 'busca',
      tipo: 'paso',
      titulo: ['Busca el caso'],
      detalle: 'Pedido, guía y lo que ya se le respondió antes. No lo hace repetir su historia.',
      x: 220,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'decide',
      tipo: 'decision',
      titulo: ['¿Sabe', 'resolverlo?'],
      detalle: 'Contra lo que le enseñaste: políticas, tiempos y qué puede prometer.',
      x: 410,
      y: 105,
      ancho: 150,
      alto: ALTO_DECISION,
    },
    {
      id: 'responde',
      tipo: 'paso',
      titulo: ['Responde y', 'confirma'],
      detalle: 'Da la respuesta y verifica que quedó resuelto antes de cerrar.',
      x: 600,
      y: 15,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'cierra',
      tipo: 'fin',
      titulo: ['Cierra el caso'],
      detalle: 'Con el registro de qué se resolvió y en cuánto tiempo.',
      x: 790,
      y: 105,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'escala',
      tipo: 'fin',
      alterna: true,
      titulo: ['Escala con el', 'contexto armado'],
      detalle: 'La persona que recibe no arranca de cero: ya tiene el caso resumido.',
      x: 600,
      y: 210,
      ancho: 170,
      alto: ALTO_CAJA,
    },
  ],
  aristas: [
    { de: 'entra', a: 'busca' },
    { de: 'busca', a: 'decide' },
    { de: 'decide', a: 'responde', etiqueta: 'sí' },
    { de: 'responde', a: 'cierra' },
    { de: 'decide', a: 'escala', etiqueta: 'no' },
  ],
}

const backoffice: Flujo = {
  id: 'backoffice',
  nombre: 'Back-office',
  linea: 'Concilia, radica y cierra los trámites repetitivos que hoy hace alguien a mano.',
  ancho: 1170,
  alto: 290,
  pasos: [
    {
      id: 'entra',
      tipo: 'inicio',
      etiqueta: 'Documento que llega',
      titulo: ['Entra una', 'factura'],
      detalle: 'Por correo o desde la carpeta donde tu equipo las deja hoy.',
      x: 10,
      y: 105,
      ancho: 180,
      alto: ALTO_ENTRADA,
    },
    {
      id: 'extrae',
      tipo: 'paso',
      titulo: ['Extrae los', 'campos'],
      detalle: 'Nit, valor, fechas y conceptos. Lo que hoy alguien copia a mano.',
      x: 240,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'cruza',
      tipo: 'paso',
      titulo: ['Cruza contra', 'tu sistema'],
      detalle: 'Orden de compra, contrato o lo que corresponda validar en tu operación.',
      x: 430,
      y: 117,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'decide',
      tipo: 'decision',
      titulo: ['¿Cuadra?'],
      detalle: 'Valores, fechas y responsable. Si algo no coincide, no lo pasa.',
      x: 620,
      y: 105,
      ancho: 150,
      alto: ALTO_DECISION,
    },
    {
      id: 'registra',
      tipo: 'paso',
      titulo: ['Registra y', 'archiva'],
      detalle: 'Queda radicado donde va, con el documento adjunto.',
      x: 810,
      y: 15,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'traza',
      tipo: 'fin',
      titulo: ['Deja la traza'],
      detalle: 'Quién, cuándo y contra qué se validó. Auditable sin pedirle nada a nadie.',
      x: 1000,
      y: 105,
      ancho: 150,
      alto: ALTO_CAJA,
    },
    {
      id: 'cuarentena',
      tipo: 'fin',
      alterna: true,
      titulo: ['Cuarentena con', 'el motivo'],
      detalle: 'No adivina: separa el documento y dice exactamente qué no cuadró.',
      x: 810,
      y: 210,
      ancho: 160,
      alto: ALTO_CAJA,
    },
  ],
  aristas: [
    { de: 'entra', a: 'extrae' },
    { de: 'extrae', a: 'cruza' },
    { de: 'cruza', a: 'decide' },
    { de: 'decide', a: 'registra', etiqueta: 'sí' },
    { de: 'registra', a: 'traza' },
    { de: 'decide', a: 'cuarentena', etiqueta: 'no' },
  ],
}

export const FLUJOS: readonly Flujo[] = [cobranza, datos, soporte, backoffice]

/** El camino que recorre "siguiente paso": todo menos la rama alterna. */
export const secuenciaDe = (flujo: Flujo): readonly Paso[] => flujo.pasos.filter((p) => !p.alterna)

export const pasoPorId = (flujo: Flujo, id: string): Paso | undefined =>
  flujo.pasos.find((p) => p.id === id)
