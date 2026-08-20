import { randomUUID } from 'node:crypto'
import type { Acuerdo, Contacto, Deudor, Obligacion, Pago } from '@/domain/types'
import type { PasoTraza } from '@/demo/estado'
import { cargarContexto } from '@/repo/cobranza/contexto'
import { pausarAgente } from '@/repo/cobranza/conversaciones'
import type { Db } from '@/repo/db'
import type { ConsumoIa, PuertoAgente } from './puerto'

/**
 * El agente contra Postgres.
 *
 * La otra implementación de `PuertoAgente`. Las herramientas no cambian —son
 * las mismas seis que aplican los límites de negociación— y por eso un acuerdo
 * fuera de rango se rechaza igual acá que en la demo de la landing.
 *
 * Las lecturas se cargan una vez con `abrirPuerto` y quedan fijas durante el
 * turno. Es deliberado: si el saldo pudiera cambiar entre dos herramientas del
 * mismo turno, el agente diría dos cifras distintas en el mismo mensaje.
 */

const aCentavos = (pesos: number): number => Math.round(pesos * 100)

export class PuertoPostgres implements PuertoAgente {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
    private readonly conversacionId: string,
    readonly deudor: Deudor,
    readonly obligacion: Obligacion,
    readonly contactosPrevios: Contacto[],
    readonly acuerdoVigente: Acuerdo | null,
  ) {}

  /**
   * El acuerdo y el estado de la obligación van en la **misma transacción**.
   *
   * El UPDATE no es contabilidad: `estado = 'acuerdo_vigente'` es lo que hace
   * que el guard responda `acuerdo_vigente` y frene la cadencia. Si el INSERT
   * pasara y el UPDATE fallara, quedaría un deudor que acordó y un motor que le
   * sigue escribiendo — que es hostigamiento, y encima del caso que salió bien.
   */
  async guardarAcuerdo(acuerdo: Acuerdo): Promise<void> {
    await this.db.transaccion(async (tx) => {
      await tx.query(
        `INSERT INTO acuerdos (id, tenant_id, obligacion_id, tipo, monto_acordado_centavos,
                               descuento_pct, numero_cuotas, primera_cuota_el, estado,
                               propuesto_en, aprobado_por, aprobado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11)`,
        [
          acuerdo.id,
          this.tenantId,
          acuerdo.obligacionId,
          acuerdo.tipo,
          aCentavos(acuerdo.montoAcordado),
          acuerdo.descuentoPct,
          acuerdo.numeroCuotas,
          acuerdo.primeraCuotaEl,
          acuerdo.estado,
          acuerdo.propuestoEn,
          acuerdo.aprobadoEn,
        ],
      )

      await tx.query(
        `UPDATE obligaciones SET estado = 'acuerdo_vigente'
          WHERE tenant_id = $1 AND id = $2 AND estado NOT IN ('pagada','castigada','juridico')`,
        [this.tenantId, acuerdo.obligacionId],
      )
    })
  }

  async guardarPago(pago: Pago): Promise<void> {
    await this.db.query(
      `INSERT INTO pagos (id, tenant_id, obligacion_id, referencia, monto_centavos, pasarela,
                          estado, atribuido_al_agente, creado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, referencia) DO NOTHING`,
      [
        pago.id,
        this.tenantId,
        pago.obligacionId,
        pago.referencia,
        aCentavos(pago.monto),
        pago.pasarela,
        pago.estado,
        pago.atribuidoAlAgente,
        pago.creadoEn,
      ],
    )
  }

  async tomaUnHumano(): Promise<void> {
    await pausarAgente(this.db, this.tenantId, this.conversacionId, {
      usuarioId: null,
      motivo: 'El agente escaló el caso',
    })
  }

  async marcarNumeroErrado(en: string): Promise<void> {
    // Mismo `WHERE ... IS NULL` que el webhook: la fecha del primer aviso es la
    // que vale como evidencia, y cada aviso posterior la reescribía hacia
    // adelante borrando el dato.
    await this.db.query(
      `UPDATE deudores SET numero_errado_en = $3
        WHERE tenant_id = $1 AND id = $2 AND numero_errado_en IS NULL`,
      [this.tenantId, this.deudor.id, en],
    )
    await this.tomaUnHumano()
  }

  /**
   * La traza va a `agent_events`, que ya existía y no la escribía nadie.
   *
   * `bloqueado_por` separa lo que el agente consultó de lo que **no pudo
   * hacer**: un acuerdo rechazado por exceder los límites es la mitad de la
   * historia que le importa al cliente, y guardarlo como un paso más lo
   * escondería entre los demás.
   */
  async anotarPaso(paso: Omit<PasoTraza, 'id' | 'ts'>): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_events (tenant_id, paso, decision, motivo, bloqueado_por,
                                 conversacion_id, obligacion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        this.tenantId,
        paso.herramienta,
        paso.estado,
        paso.detalle,
        paso.estado === 'bloqueado' ? paso.herramienta : null,
        this.conversacionId,
        this.obligacion.id,
      ],
    )
  }

  /**
   * El costo de IA del turno, en la misma tabla que la traza.
   *
   * `conversacion_id` es la llave y no es casual: la conversación es la unidad
   * en la que se mide el costo y la unidad que se factura, y así está escrito
   * en la migración que agregó la columna.
   */
  async anotarConsumoIa(consumo: ConsumoIa): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_events (tenant_id, paso, decision, motivo, proveedor,
                                 tokens_in, tokens_out, latencia_ms,
                                 conversacion_id, obligacion_id)
       VALUES ($1,'cerebro','ok','',$2,$3,$4,$5,$6,$7)`,
      [
        this.tenantId,
        consumo.proveedor,
        consumo.tokensEntrada,
        consumo.tokensSalida,
        consumo.latenciaMs,
        this.conversacionId,
        this.obligacion.id,
      ],
    )
  }

  nonce(): string {
    // Corto y sin guiones: la referencia de pago viaja en una URL que el deudor
    // ve y a veces teclea.
    return randomUUID().replace(/-/g, '').slice(0, 8)
  }

  nuevoId(): string {
    return randomUUID()
  }
}

/**
 * Carga el expediente y devuelve el puerto listo.
 *
 * `null` cuando la conversación no tiene obligación: el agente no tiene nada que
 * cobrar y no debería abrir la boca. Pasa de verdad —un deudor que terminó de
 * pagar y escribe— y es un caso para una persona, no para el agente.
 */
export async function abrirPuerto(
  db: Db,
  tenantId: string,
  params: { conversacionId: string; obligacionId: string | null },
): Promise<PuertoPostgres | null> {
  if (!params.obligacionId) return null

  const ctx = await cargarContexto(db, tenantId, params.obligacionId)
  if (!ctx) return null

  const [acuerdo] = await db.query<{
    id: string
    tipo: Acuerdo['tipo']
    monto_acordado_centavos: string
    descuento_pct: string
    numero_cuotas: number
    primera_cuota_el: Date | string | null
    estado: Acuerdo['estado']
    propuesto_en: Date
    aprobado_en: Date | null
  }>(
    `SELECT id, tipo, monto_acordado_centavos, descuento_pct, numero_cuotas, primera_cuota_el,
            estado, propuesto_en, aprobado_en
       FROM acuerdos
      WHERE tenant_id = $1 AND obligacion_id = $2
        AND estado IN ('propuesto_por_agente','esperando_aprobacion','aprobado','vigente')
      ORDER BY propuesto_en DESC LIMIT 1`,
    [tenantId, params.obligacionId],
  )

  const vigente: Acuerdo | null = acuerdo
    ? {
        id: acuerdo.id,
        clienteId: tenantId,
        obligacionId: params.obligacionId,
        tipo: acuerdo.tipo,
        montoAcordado: Math.round(Number(acuerdo.monto_acordado_centavos) / 100),
        descuentoPct: Number(acuerdo.descuento_pct),
        numeroCuotas: acuerdo.numero_cuotas,
        primeraCuotaEl: String(
          acuerdo.primera_cuota_el instanceof Date
            ? acuerdo.primera_cuota_el.toISOString().slice(0, 10)
            : (acuerdo.primera_cuota_el ?? ''),
        ),
        estado: acuerdo.estado,
        propuestoEn: acuerdo.propuesto_en.toISOString(),
        // NULL en `aprobado_por` con estado `aprobado` significa que lo aprobó
        // la política preconfigurada, no una persona. La columna es `uuid` y no
        // acepta una etiqueta; la distinción persona/política se lee de ahí.
        aprobadoPor: null,
        aprobadoEn: acuerdo.aprobado_en?.toISOString() ?? null,
        motivoRechazo: null,
      }
    : null

  return new PuertoPostgres(
    db,
    tenantId,
    params.conversacionId,
    ctx.deudor,
    ctx.obligacion,
    ctx.contactosDelDeudor,
    vigente,
  )
}
