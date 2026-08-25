import { z } from 'zod'

/**
 * Modelo canónico de cartera. Toda fuente de datos (Excel, Sheets, BD directa,
 * push API) se normaliza a estas formas antes de tocar el motor de cadencia.
 *
 * Los montos son enteros en pesos colombianos. El COP no se fracciona en la
 * práctica de cobranza, y trabajar en enteros evita el error de redondeo que
 * aparecería al liquidar acuerdos en cuotas.
 */

export const Canal = z.enum(['whatsapp', 'sms'])
export type Canal = z.infer<typeof Canal>

/**
 * Por dónde ocurrió un contacto. Más ancho que `Canal`, a propósito.
 *
 * Una llamada deja evidencia y consume el cupo de frecuencia de la Ley 2300
 * igual que un mensaje, así que tiene que poder ser un `Contacto`. Pero no se
 * envía con un `ChannelProvider` ni se cotiza por mensaje: meterla en `Canal`
 * obligaría a `crearProveedores` a devolver un proveedor de voz que implemente
 * `enviar(MensajeSaliente)` —una llamada no es un mensaje saliente— y mandaría
 * la voz a `TARIFA_TWILIO_SMS`, que lanza.
 *
 * La regla, entonces: `Canal` es por dónde se **envía** un mensaje;
 * `CanalContacto` es por dónde se **tocó** a la persona.
 */
export const CanalContacto = z.enum([...Canal.options, 'voz'])
export type CanalContacto = z.infer<typeof CanalContacto>

/**
 * Ley 2300 art. 3: el contacto directo solo procede con el deudor principal,
 * codeudor o deudor solidario. Una `referencia` nunca puede ser destinataria;
 * el guard de compliance la bloquea sin excepción.
 */
export const RolContacto = z.enum(['titular', 'codeudor', 'solidario', 'referencia'])
export type RolContacto = z.infer<typeof RolContacto>

/** Tramos de mora. Cada uno tiene su propia cadencia y sus propios límites de negociación. */
export const TramoMora = z.enum(['preventiva', 'temprana', 'media', 'tardia', 'castigada'])
export type TramoMora = z.infer<typeof TramoMora>

export const FuenteConsentimiento = z.enum(['pagare', 'formulario_web', 'contrato', 'importado'])
export type FuenteConsentimiento = z.infer<typeof FuenteConsentimiento>

export const Consentimiento = z.object({
  otorgado: z.boolean(),
  fuente: FuenteConsentimiento,
  fecha: z.string().describe('ISO 8601'),
  /**
   * Opt-out explícito del deudor. Es absoluto: gana sobre cualquier
   * consentimiento previo y sobre cualquier cadencia activa.
   */
  revocadoEn: z.string().nullable().default(null),
})
export type Consentimiento = z.infer<typeof Consentimiento>

/**
 * Ley 2300 art. 5: el deudor puede fijar canal, día y hora de contacto.
 * Lo que fije aquí restringe la ventana legal, nunca la amplía.
 */
export const PreferenciaContacto = z.object({
  canal: CanalContacto.nullable().default(null),
  /** 1 = lunes … 6 = sábado. El domingo nunca es válido, ni siquiera si lo pide. */
  diaSemana: z.number().int().min(1).max(6).nullable().default(null),
  horaDesde: z.number().int().min(0).max(23).nullable().default(null),
  horaHasta: z.number().int().min(0).max(23).nullable().default(null),
})
export type PreferenciaContacto = z.infer<typeof PreferenciaContacto>

export const TipoDocumento = z.enum(['CC', 'CE', 'NIT', 'TI', 'PA', 'PEP', 'OTRO'])
export type TipoDocumento = z.infer<typeof TipoDocumento>

export const Deudor = z.object({
  id: z.string(),
  clienteId: z.string(),
  tipoDocumento: TipoDocumento,
  documento: z.string().min(1),
  nombre: z.string().min(1),
  /** E.164. El primero es el canal principal. */
  telefonos: z.array(z.string()).min(1),
  email: z.string().nullable().default(null),
  rol: RolContacto.default('titular'),
  consentimiento: Consentimiento,
  preferencia: PreferenciaContacto,
  /**
   * Cuándo alguien en este número dijo que el deudor no es él.
   *
   * Es distinto de `consentimiento.revocadoEn` y por eso es un campo aparte. La
   * baja la pide el deudor y es irreversible; esto lo afirma quien contesta el
   * teléfono y **está por verificar**: el número puede ser correcto y la persona
   * estar esquivando. El guard bloquea igual —seguir escribiéndole a un tercero
   * es tratamiento de datos de alguien que nunca autorizó nada— pero un humano
   * puede limpiarlo si comprueba que el dato de la cartera estaba bien.
   */
  numeroErradoEn: z.string().nullable().default(null),
})
export type Deudor = z.infer<typeof Deudor>

export const EstadoObligacion = z.enum([
  'al_dia',
  'en_mora',
  'acuerdo_vigente',
  'pagada',
  'castigada',
  'juridico',
])
export type EstadoObligacion = z.infer<typeof EstadoObligacion>

export const Obligacion = z.object({
  id: z.string(),
  clienteId: z.string(),
  deudorId: z.string(),
  numeroCredito: z.string(),
  capital: z.number().int().nonnegative(),
  interesMora: z.number().int().nonnegative().default(0),
  saldoTotal: z.number().int().nonnegative(),
  fechaVencimiento: z.string().describe('ISO date, YYYY-MM-DD'),
  diasMora: z.number().int(),
  tramo: TramoMora,
  estado: EstadoObligacion,
})
export type Obligacion = z.infer<typeof Obligacion>

export const ResultadoEnvio = z.enum([
  'encolado',
  'enviado',
  'entregado',
  'leido',
  'fallido',
  'bloqueado',
])
export type ResultadoEnvio = z.infer<typeof ResultadoEnvio>

/**
 * Registro inmutable de todo intento de contacto, incluidos los que el guard
 * bloqueó. Los bloqueados son el entregable de compliance ante la SIC: prueban
 * que el sistema respetó la Ley 2300 en lugar de limitarse a no dejar rastro.
 */
export const Contacto = z.object({
  id: z.string(),
  clienteId: z.string(),
  obligacionId: z.string(),
  deudorId: z.string(),
  canal: CanalContacto,
  direccion: z.enum(['saliente', 'entrante']),
  /** ISO 8601 con offset. Siempre se evalúa contra hora de Bogotá. */
  timestamp: z.string(),
  plantillaId: z.string().nullable().default(null),
  cuerpo: z.string().default(''),
  resultado: ResultadoEnvio,
  motivoBloqueo: z.string().nullable().default(null),
  /**
   * Costo real en COP, para conciliar consumo contra el cupo del plan.
   *
   * No es entero a propósito: una plantilla `utility` en Colombia vía Meta
   * directo cuesta COP 3,2 y redondear cada mensaje a entero subestimaría el
   * costo un 6%. Los montos de cartera sí son enteros; este no es cartera.
   */
  costoCop: z.number().nonnegative().default(0),
  /**
   * Id del mensaje en el proveedor (`wamid` en Meta, `SID` en Twilio).
   *
   * Es la única llave que permite correlacionar un webhook de estado con el
   * contacto que lo originó. Sin ella, `entregado` y `leido` nunca se pueden
   * escribir de vuelta y el log de compliance queda congelado en `encolado`.
   */
  idProveedor: z.string().nullable().default(null),
  /** Qué implementación lo envió. Necesario ahora que WhatsApp y SMS van por proveedores distintos. */
  proveedor: z.string().nullable().default(null),
})
export type Contacto = z.infer<typeof Contacto>

/**
 * Ventana de servicio de WhatsApp.
 *
 * Un mensaje del deudor abre 24 horas durante las cuales se le puede responder
 * texto libre, y Meta no cobra ninguno de esos mensajes. Fuera de la ventana
 * solo se aceptan plantillas aprobadas, y esas sí se cobran.
 *
 * **No es una regla legal.** La Ley 2300 dice *cuándo* se puede contactar; esto
 * dice *qué formato* acepta Meta. Un mensaje puede caer dentro de la ventana de
 * servicio y seguir siendo ilegal por ser domingo. El guard manda, y se evalúa
 * primero; esto solo decide si hace falta plantilla.
 */
export const VentanaServicio = z.object({
  clienteId: z.string(),
  deudorId: z.string(),
  /** ISO 8601 del último mensaje entrante del deudor. */
  abiertaEn: z.string(),
  /** `abiertaEn` + 24 h. Se materializa para poder indexar y auditar. */
  expiraEn: z.string(),
})
export type VentanaServicio = z.infer<typeof VentanaServicio>

export const TipoAcuerdo = z.enum(['pago_total', 'pago_parcial', 'cuotas', 'descuento'])
export type TipoAcuerdo = z.infer<typeof TipoAcuerdo>

export const EstadoAcuerdo = z.enum([
  'propuesto_por_agente',
  'esperando_aprobacion',
  'aprobado',
  'rechazado',
  'vigente',
  'cumplido',
  'incumplido',
])
export type EstadoAcuerdo = z.infer<typeof EstadoAcuerdo>

/**
 * Ningún acuerdo llega al deudor sin pasar por `aprobado`. El agente solo
 * propone; un humano del cliente decide.
 */
export const Acuerdo = z.object({
  id: z.string(),
  clienteId: z.string(),
  obligacionId: z.string(),
  tipo: TipoAcuerdo,
  montoAcordado: z.number().int().nonnegative(),
  descuentoPct: z.number().min(0).max(100).default(0),
  numeroCuotas: z.number().int().min(1).default(1),
  primeraCuotaEl: z.string().nullable().default(null),
  estado: EstadoAcuerdo,
  propuestoEn: z.string(),
  aprobadoPor: z.string().nullable().default(null),
  aprobadoEn: z.string().nullable().default(null),
  motivoRechazo: z.string().nullable().default(null),
})
export type Acuerdo = z.infer<typeof Acuerdo>

export const EstadoPago = z.enum(['pendiente', 'aprobado', 'declinado', 'anulado', 'error'])
export type EstadoPago = z.infer<typeof EstadoPago>

export const Pago = z.object({
  id: z.string(),
  clienteId: z.string(),
  obligacionId: z.string(),
  /** Referencia única generada por nosotros. Es lo que hace medible la atribución. */
  referencia: z.string(),
  monto: z.number().int().positive(),
  pasarela: z.enum(['wompi', 'epayco', 'bold']),
  transaccionId: z.string().nullable().default(null),
  estado: EstadoPago,
  creadoEn: z.string(),
  pagadoEn: z.string().nullable().default(null),
  /**
   * Se marca cuando el pago entra dentro de la ventana de atribución tras un
   * contacto del agente. Alimenta el success fee de fase 2.
   */
  atribuidoAlAgente: z.boolean().default(false),
})
export type Pago = z.infer<typeof Pago>

/**
 * Meta reclasifica a `marketing` (≈4x el costo) cualquier plantilla utility que
 * incluya lenguaje promocional. La categoría se declara aquí para poder
 * auditarla y para calcular el costo del cupo correctamente.
 */
export const CategoriaPlantilla = z.enum(['utility', 'marketing', 'authentication'])
export type CategoriaPlantilla = z.infer<typeof CategoriaPlantilla>

export const Plantilla = z.object({
  id: z.string(),
  clienteId: z.string(),
  nombre: z.string(),
  canal: Canal,
  categoria: CategoriaPlantilla,
  /** Nombre de la plantilla aprobada en Meta. Null para SMS. */
  nombreMeta: z.string().nullable().default(null),
  cuerpo: z.string(),
  variables: z.array(z.string()).default([]),
  aprobadaEnMeta: z.boolean().default(false),
})
export type Plantilla = z.infer<typeof Plantilla>

export const PasoCadencia = z.object({
  /**
   * Días desde el ancla del tramo. Negativo = antes del vencimiento
   * (cadencia preventiva).
   */
  offsetDias: z.number().int(),
  canal: Canal,
  plantillaId: z.string(),
  /** Si el fallback está activo y WhatsApp no entrega, se reintenta por SMS. */
  fallbackSms: z.boolean().default(false),
})
export type PasoCadencia = z.infer<typeof PasoCadencia>

export const Cadencia = z.object({
  id: z.string(),
  clienteId: z.string(),
  tramo: TramoMora,
  pasos: z.array(PasoCadencia),
  activa: z.boolean().default(true),
})
export type Cadencia = z.infer<typeof Cadencia>

export const Tier = z.enum(['pequena', 'mediana', 'grande', 'corporativo'])
export type Tier = z.infer<typeof Tier>

/**
 * Límites duros de negociación. El agente no puede ofrecer nada fuera de este
 * rango; si el deudor pide más, escala a humano en vez de improvisar.
 */
export const LimitesNegociacion = z.object({
  descuentoMaxPct: z.number().min(0).max(100).default(0),
  cuotasMax: z.number().int().min(1).default(1),
  diasPlazoMax: z.number().int().min(0).default(0),
  montoMinimoAbono: z.number().int().nonnegative().default(0),
})
export type LimitesNegociacion = z.infer<typeof LimitesNegociacion>

export const Cliente = z.object({
  id: z.string(),
  nombre: z.string(),
  tier: Tier,
  /** Cuenta entrantes y salientes. Contar solo salientes deja gratis la mitad del costo. */
  cupoMensajesMes: z.number().int().positive(),
  limitesPorTramo: z.record(TramoMora, LimitesNegociacion),
  zonaHoraria: z.string().default('America/Bogota'),
})
export type Cliente = z.infer<typeof Cliente>
