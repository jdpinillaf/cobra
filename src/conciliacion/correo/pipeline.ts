import { anotarEvento } from '@/repo/conciliacion/eventos'
import { guardarAviso } from '@/repo/conciliacion/notificaciones'
import { correoYaVisto, guardarCorreoCrudo, type Clasificacion } from '@/repo/raw-emails'
import type { ConfigConciliacion } from '@/repo/tenants'
import type { Db } from '@/repo/db'
import { clasificar } from './clasificar'
import { cadenaDeReenvio, parsearMime } from './mime'
import { huellaDelAviso, parsearAviso, type AvisoBancario } from './parser'
import type { VerificadorCorreo } from './verificador'

/**
 * De los bytes del correo a un aviso guardado, o a un motivo escrito.
 *
 * Cinco puntos de caída y **ninguno silencioso**. Cada uno escribe en
 * `agent_events` con su motivo, y los que importan además dejan el correo
 * crudo. La regla que ordena todo esto: el modo de falla más caro de este
 * producto no es fallar, es fallar sin que nadie se entere.
 *
 *   alias existe                     → no: lo descartó el Worker, no llega acá
 *   firma + remitente + reenvío      → falla: cuarentena, y se guarda el crudo
 *   clasificar                       → no es ingreso: se descarta sin persistir
 *   parsear                          → falla: se guarda el crudo y **alerta**
 *   cuenta destino contra el tenant  → no coincide: cuarentena
 *   conciliar
 *
 * **La firma va antes que la clasificación.** Es el orden del §5 del plan y no
 * es casual: clasificar primero significaría decidir qué hacer con un correo
 * antes de saber si lo escribió el banco, y el ataque consiste justamente en
 * mandar un texto que parezca un ingreso.
 *
 * **Lo que no es ingreso se descarta sin persistir.** Un aviso de egreso trae a
 * quién le pagó el comerciante; uno de seguridad, señales de su cuenta. Guardar
 * menos datos de terceros es menos riesgo y es lo que se le promete al cliente.
 * La excepción es todo lo que sí parece un ingreso: eso se guarda siempre,
 * incluso —sobre todo— cuando no se pudo leer.
 */

export type EstadoIngesta =
  | 'conciliable'
  | 'duplicado'
  | 'cuarentena'
  | 'descartado'
  | 'sin_parsear'

export interface ResultadoIngesta {
  estado: EstadoIngesta
  motivo: string
  rawEmailId: string | null
  avisoId: string | null
  clasificacion: Clasificacion
  /** El aviso leído, para que quien llame pueda encolar el cruce sin releer. */
  aviso: AvisoBancario | null
  /** `true` cuando hay que despertar a alguien: el banco cambió la redacción. */
  alerta: boolean
}

export async function ingerirCorreo(
  db: Db,
  params: {
    tenant: ConfigConciliacion
    /** Los bytes exactos que llegaron. No normalizados: DKIM se calcula sobre ellos. */
    crudo: string
    verificador: VerificadorCorreo
    /** En producción se descarta lo que no es ingreso. En desarrollo conviene verlo. */
    guardarNoIngresos?: boolean
  },
): Promise<ResultadoIngesta> {
  const { tenant, crudo, verificador } = params
  const correo = parsearMime(crudo)

  const evento = (paso: Parameters<typeof anotarEvento>[2]['paso'], decision: 'ok' | 'bloqueado', motivo: string) =>
    anotarEvento(db, tenant.id, { paso, decision, motivo })

  const salida = (
    estado: EstadoIngesta,
    motivo: string,
    extra: Partial<ResultadoIngesta> = {},
  ): ResultadoIngesta => ({
    estado,
    motivo,
    rawEmailId: null,
    avisoId: null,
    clasificacion: 'desconocido',
    aviso: null,
    alerta: false,
    ...extra,
  })

  // Sin `Message-ID` no hay forma de deduplicar, y un correo que se reenvía dos
  // veces se contaría dos veces. Todo MTA lo pone; que falte ya es señal.
  if (!correo.messageId) {
    await evento('correo_recibido', 'bloqueado', 'el correo no trae Message-ID')
    const { id } = await guardarCorreoCrudo(db, tenant.id, {
      messageId: `sin-id:${Date.now()}:${correo.asunto ?? ''}`,
      crudo,
      fromAddr: correo.de,
      subject: correo.asunto,
      cuarentena: true,
      motivo: 'sin Message-ID',
      clasificacion: 'desconocido',
    })
    return salida('cuarentena', 'sin Message-ID', { rawEmailId: id })
  }

  if (await correoYaVisto(db, tenant.id, correo.messageId)) {
    // Sin ruido y sin trabajo: no se verifica la firma de nuevo, que hace
    // consultas de DNS, ni se vuelve a anotar el paso.
    return salida('duplicado', 'ya se había recibido este correo')
  }

  await evento('correo_recibido', 'ok', `de ${correo.de ?? '?'} · ${correo.asunto ?? 'sin asunto'}`)

  // ── 1. ¿Lo escribió el banco? ─────────────────────────────────────────────
  const firma = await verificador.verificar(crudo, tenant.dkimDominioEsperado)
  const remitenteConocido =
    tenant.remitentes.length === 0
      ? // Sin remitentes cargados no se puede validar la dirección, y adivinar
        // una constante es justo lo que el esquema evita: Bancolombia ha usado
        // varias. Se apoya solo en la firma, que es la defensa fuerte.
        true
      : tenant.remitentes.some((r) => r.direccion === correo.de)

  const tieneCadena = cadenaDeReenvio(correo).length > 0

  const problemas = [
    firma.autentico ? null : firma.motivo,
    remitenteConocido ? null : `remitente no reconocido: ${correo.de ?? '?'}`,
    tieneCadena ? null : 'sin cadena de reenvío: el correo no pasó por el Gmail del cliente',
  ].filter((p): p is string => p !== null)

  if (problemas.length > 0) {
    const motivo = problemas.join(' · ')
    await evento('dkim', 'bloqueado', motivo)
    const { id } = await guardarCorreoCrudo(db, tenant.id, {
      messageId: correo.messageId,
      crudo,
      fromAddr: correo.de,
      subject: correo.asunto,
      dkimOk: firma.autentico,
      dkimDomain: firma.dominio,
      cuarentena: true,
      motivo,
      clasificacion: clasificar(correo.texto),
    })
    return salida('cuarentena', motivo, { rawEmailId: id })
  }

  await evento('dkim', 'ok', `firmado por ${firma.dominio}`)

  // ── 2. ¿De qué habla? ─────────────────────────────────────────────────────
  const clasificacion = clasificar(correo.texto)
  if (clasificacion !== 'ingreso') {
    await evento('clasificacion', 'ok', `${clasificacion}: no es un aviso de ingreso`)
    if (!params.guardarNoIngresos) {
      return salida('descartado', `no es un ingreso (${clasificacion})`, { clasificacion })
    }
    const { id } = await guardarCorreoCrudo(db, tenant.id, {
      messageId: correo.messageId,
      crudo,
      fromAddr: correo.de,
      subject: correo.asunto,
      dkimOk: true,
      dkimDomain: firma.dominio,
      clasificacion,
    })
    return salida('descartado', `no es un ingreso (${clasificacion})`, {
      rawEmailId: id,
      clasificacion,
    })
  }

  // ── 3. ¿Se puede leer? ────────────────────────────────────────────────────
  let aviso: AvisoBancario | null = null
  let falloDeParseo: string | null = null
  try {
    aviso = parsearAviso(correo.texto)
    if (!aviso) falloDeParseo = 'ningún patrón conocido matcheó la frase'
  } catch (error) {
    falloDeParseo = error instanceof Error ? error.message : String(error)
  }

  if (!aviso) {
    // **Nunca se descarta.** Este correo es la única evidencia de qué cambió, y
    // la alerta es lo que hace que se sepa hoy y no en tres semanas con
    // clientes furiosos. Si Bancolombia cambia la redacción se caen todos los
    // clientes a la vez: no hay diversificación de bancos que amortigüe.
    await evento('parse_email', 'bloqueado', falloDeParseo ?? 'no se pudo leer')
    const { id } = await guardarCorreoCrudo(db, tenant.id, {
      messageId: correo.messageId,
      crudo,
      fromAddr: correo.de,
      subject: correo.asunto,
      dkimOk: true,
      dkimDomain: firma.dominio,
      clasificacion,
      parseOk: false,
      motivo: falloDeParseo,
    })
    return salida('sin_parsear', falloDeParseo ?? 'no se pudo leer', {
      rawEmailId: id,
      clasificacion,
      alerta: true,
    })
  }

  // ── 4. ¿Entró a la cuenta de este comerciante? ────────────────────────────
  if (tenant.cuentaUltimos4 && aviso.cuentaUltimos4 !== tenant.cuentaUltimos4) {
    const motivo = `la cuenta *${aviso.cuentaUltimos4} no es la del comerciante (*${tenant.cuentaUltimos4})`
    await evento('cuenta_destino', 'bloqueado', motivo)
    const { id } = await guardarCorreoCrudo(db, tenant.id, {
      messageId: correo.messageId,
      crudo,
      fromAddr: correo.de,
      subject: correo.asunto,
      dkimOk: true,
      dkimDomain: firma.dominio,
      clasificacion,
      parseOk: true,
      bancoAt: aviso.ocurridoEn,
      cuarentena: true,
      motivo,
    })
    return salida('cuarentena', motivo, { rawEmailId: id, clasificacion, aviso })
  }

  // ── 5. Adentro ────────────────────────────────────────────────────────────
  const { id: rawEmailId } = await guardarCorreoCrudo(db, tenant.id, {
    messageId: correo.messageId,
    crudo,
    fromAddr: correo.de,
    subject: correo.asunto,
    dkimOk: true,
    dkimDomain: firma.dominio,
    clasificacion,
    parseOk: true,
    bancoAt: aviso.ocurridoEn,
  })

  const { id: avisoId } = await guardarAviso(db, tenant.id, {
    rawEmailId,
    aviso,
    huella: huellaDelAviso(aviso),
  })

  await evento(
    'parse_email',
    'ok',
    `${aviso.plantilla}: $${(aviso.montoCentavos / 100).toLocaleString('es-CO')} de ${aviso.remitenteRaw}`,
  )

  return salida('conciliable', 'aviso guardado', {
    rawEmailId,
    avisoId,
    clasificacion,
    aviso,
  })
}
