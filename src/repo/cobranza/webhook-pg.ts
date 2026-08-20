import type { CambioEstado, MensajeEntrante } from '@/channels/meta-webhook'
import type { RepositorioWebhook } from '@/channels/procesador-webhook'
import { tarifaDe } from '@/channels/provider'
import type { Db } from '../db'
import { registrarContacto } from './contactos'
import { abrirOReutilizar } from './conversaciones'
import { renovarVentana } from './ventanas'

/**
 * El puerto del webhook, contra Postgres.
 *
 * `procesarWebhook` no se toca: la orquestación ya estaba escrita y probada
 * contra un repositorio en memoria. Esto es implementar una interfaz de seis
 * métodos, que era exactamente el punto de haberla definido antes de tener base.
 *
 * La instancia se ata a **un** tenant en el constructor. La interfaz no lleva
 * `tenantId` en sus métodos, y agregárselo habría obligado a tocar el flujo; el
 * tenant se resuelve una vez, en la ruta, a partir del `phone_number_id`, y
 * desde ahí todo lo que escribe esta clase ya está acotado.
 */
export class RepositorioPostgres implements RepositorioWebhook {
  /**
   * Quién dice que trajo el mensaje.
   *
   * `meta` es lo normal. `simulado` lo usa el botón de demo de la consola, y no
   * es cosmético: un mensaje que nos inventamos nosotros no puede contarse como
   * evidencia ante la SIC ni sumar en la pantalla de consumo. Queda escrito en
   * la fila, para siempre, y cualquier consulta puede separarlos.
   */
  private readonly proveedor: 'meta' | 'simulado'

  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
    opciones: { proveedor?: 'meta' | 'simulado' } = {},
  ) {
    this.proveedor = opciones.proveedor ?? 'meta'
  }

  /**
   * Idempotencia atómica: se intenta insertar y el conflicto es la respuesta.
   *
   * Un `SELECT` y después un `INSERT` deja una ventana entre los dos por la que
   * dos entregas simultáneas del mismo mensaje pasan las dos. Acá el índice
   * único decide, y decide una sola vez.
   */
  async yaProcesado(llave: string): Promise<boolean> {
    const filas = await this.db.query<{ llave: string }>(
      `INSERT INTO webhook_procesados (tenant_id, llave) VALUES ($1, $2)
       ON CONFLICT (tenant_id, llave) DO NOTHING
       RETURNING llave`,
      [this.tenantId, llave],
    )
    return filas.length === 0
  }

  /** No-op deliberado: `yaProcesado` ya dejó la marca al intentar insertarla. */
  async marcarProcesado(): Promise<void> {}

  /**
   * Escribe el estado real sobre el contacto que lo originó, por `wamid`.
   *
   * Y aprovecha lo que Meta manda de regalo: `conversation.expiration_timestamp`
   * es la ventana de servicio según él. Vale más que la nuestra, que es una
   * aproximación calculada desde el entrante.
   */
  async actualizarEstado(cambio: CambioEstado): Promise<void> {
    const filas = await this.db.query<{ deudor_id: string; canal: 'whatsapp' | 'sms' }>(
      `UPDATE contactos
          SET resultado = $3,
              motivo_bloqueo = COALESCE($4, motivo_bloqueo),
              -- Meta reclasifica: si dice que una plantilla fue marketing, el
              -- costo estimado al enviar estaba 25 veces por debajo.
              costo_cop = CASE WHEN $5::boolean IS FALSE THEN 0 ELSE costo_cop END,
              -- Lo que Meta dice que cobró le gana a lo que nosotros
              -- estimamos: es su factura la que hay que conciliar.
              categoria = COALESCE($6, categoria),
              conversacion_meta = COALESCE($7, conversacion_meta)
        WHERE tenant_id = $1 AND id_proveedor = $2
        RETURNING deudor_id, canal`,
      [
        this.tenantId,
        cambio.idProveedor,
        cambio.estado,
        cambio.error,
        cambio.facturable,
        cambio.categoria,
        cambio.conversacionMeta,
      ],
    )
    if (filas.length === 0) return

    if (cambio.categoria && cambio.facturable) {
      await this.db.query(
        `UPDATE contactos SET costo_cop = $3 WHERE tenant_id = $1 AND id_proveedor = $2`,
        [
          this.tenantId,
          cambio.idProveedor,
          tarifaDe(filas[0].canal).costoCop(filas[0].canal, cambio.categoria),
        ],
      )
    }

    if (cambio.expiraVentanaEn) {
      await this.db.query(
        `UPDATE ventanas_servicio
            SET expira_en = GREATEST(expira_en, $3::timestamptz), origen = 'meta'
          WHERE tenant_id = $1 AND deudor_id = $2`,
        [this.tenantId, filas[0].deudor_id, cambio.expiraVentanaEn],
      )
    }
  }

  /**
   * Registra el entrante y lo cuelga de su hilo.
   *
   * Un número que no está en la cartera no se escribe: no hay deudor del que
   * colgarlo y la llave foránea lo rechazaría igual. Devuelve sin error a
   * propósito — un desconocido escribiendo al número de la empresa es normal, y
   * no puede hacer que Meta reintente el lote entero.
   */
  async registrarEntrante(mensaje: MensajeEntrante): Promise<{ conversacionId: string } | null> {
    const deudorId = await this.deudorPorTelefono(mensaje.deTelefono)
    if (!deudorId) return null

    const obligacionId = await this.obligacionAbierta(deudorId)
    const { id: conversacionId } = await abrirOReutilizar(this.db, this.tenantId, {
      deudorId,
      obligacionId,
      ahora: mensaje.ocurrioEn,
    })

    await registrarContacto(this.db, this.tenantId, {
      obligacionId,
      deudorId,
      conversacionId,
      canal: 'whatsapp',
      direccion: 'entrante',
      timestamp: mensaje.ocurrioEn,
      cuerpo: mensaje.cuerpo,
      // Un entrante no se cobra nunca.
      resultado: 'entregado',
      costoCop: 0,
      idProveedor: mensaje.idProveedor,
      proveedor: this.proveedor,
    })

    if (mensaje.media) {
      await this.db.query(
        `UPDATE contactos SET media_id = $3, media_mime = $4
          WHERE tenant_id = $1 AND id_proveedor = $2`,
        [this.tenantId, mensaje.idProveedor, mensaje.media.id, mensaje.media.mimeType],
      )
    }

    return { conversacionId }
  }

  async abrirVentanaServicio(telefono: string, entranteEn: string): Promise<void> {
    const deudorId = await this.deudorPorTelefono(telefono)
    if (!deudorId) return
    await renovarVentana(this.db, this.tenantId, deudorId, entranteEn)
  }

  /**
   * El opt-out es irreversible y no se pisa.
   *
   * `revocado_en IS NULL` en el WHERE conserva la fecha del primer pedido, que
   * es la que vale como evidencia ante la SIC. Cada mensaje de baja posterior la
   * reescribía hacia adelante y borraba el dato que importa.
   */
  async revocarConsentimiento(telefono: string, en: string): Promise<void> {
    const deudorId = await this.deudorPorTelefono(telefono)
    if (!deudorId) return

    await this.db.query(
      `UPDATE deudores SET revocado_en = $3
        WHERE tenant_id = $1 AND id = $2 AND revocado_en IS NULL`,
      [this.tenantId, deudorId, en],
    )
  }

  /**
   * Alguien en este número avisó que el deudor no es él.
   *
   * Escribe la marca **y pausa el hilo**, en la misma pasada. Solo marcar
   * dejaría al guard frenando la cadencia mientras el caso no le aparece a
   * nadie: el número quedaría mudo para siempre sin que ninguna persona llegue
   * a verificar si el dato de la cartera estaba mal o si el deudor está
   * esquivando. Esto no se resuelve solo, y por eso no se archiva solo.
   *
   * Conserva la primera fecha, igual que la revocación: es la que vale como
   * evidencia de cuándo se avisó.
   */
  async marcarNumeroErrado(telefono: string, en: string): Promise<void> {
    const deudorId = await this.deudorPorTelefono(telefono)
    if (!deudorId) return

    const filas = await this.db.query<{ id: string }>(
      `UPDATE deudores SET numero_errado_en = $3
        WHERE tenant_id = $1 AND id = $2 AND numero_errado_en IS NULL
        RETURNING id`,
      [this.tenantId, deudorId, en],
    )
    // Ya estaba marcado: no se vuelve a pausar ni a pisar la fecha.
    if (filas.length === 0) return

    await this.db.query(
      `UPDATE conversaciones
          SET agente_pausado = true,
              pausada_en = COALESCE(pausada_en, $3::timestamptz)
        WHERE tenant_id = $1 AND deudor_id = $2 AND cerrada_en IS NULL`,
      [this.tenantId, deudorId, en],
    )
  }

  private async deudorPorTelefono(telefono: string): Promise<string | null> {
    const filas = await this.db.query<{ id: string }>(
      `SELECT id FROM deudores WHERE tenant_id = $1 AND telefonos @> ARRAY[$2::text] LIMIT 1`,
      [this.tenantId, telefono],
    )
    return filas[0]?.id ?? null
  }

  private async obligacionAbierta(deudorId: string): Promise<string | null> {
    const filas = await this.db.query<{ id: string }>(
      `SELECT id FROM obligaciones
        WHERE tenant_id = $1 AND deudor_id = $2 AND estado <> 'pagada'
        ORDER BY dias_mora DESC LIMIT 1`,
      [this.tenantId, deudorId],
    )
    return filas[0]?.id ?? null
  }
}
