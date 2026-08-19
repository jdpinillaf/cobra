import type { Canal, ResultadoEnvio } from '@/domain/types'
import type { Db } from '../db'

/**
 * Historial de contactos.
 *
 * `contactos` no es un log: es el entregable de cumplimiento. La cotización
 * vende "historial completo de cada intento, con hora, canal, mensaje enviado,
 * resultado y motivo, **incluidos los intentos bloqueados por política**", y
 * ante un reclamo ante la SIC esa tabla es la evidencia de que el sistema
 * respetó la Ley 2300 en vez de limitarse a no dejar rastro.
 *
 * De ahí dos reglas que parecen detalles y no lo son: se escribe una fila
 * también cuando el guard bloquea, y la lectura devuelve todo mezclado en orden
 * cronológico. Separar los bloqueados en otra consulta invita a construir la
 * consola con dos pestañas, y eso rompe justo lo que se vendió.
 */

export interface ContactoNuevo {
  obligacionId: string
  deudorId: string
  /**
   * Obligatorio al escribir.
   *
   * La columna es nullable porque un hilo borrado deja sus contactos con NULL,
   * y esa historia no se pierde. Pero al momento de registrar siempre hay hilo,
   * y sin él `tocarConversacion` se salía en silencio: la bandeja quedaba
   * ordenada con una fecha vieja y, peor, `sin_leer` devolvía false para un
   * entrante real. Un dato que sostiene el sin-leer no puede ser opcional.
   */
  conversacionId: string
  canal: Canal
  direccion: 'saliente' | 'entrante'
  /** ISO 8601 con offset. Siempre se evalúa contra hora de Bogotá. */
  timestamp: string
  plantillaId?: string | null
  cuerpo?: string
  resultado: ResultadoEnvio
  motivoBloqueo?: string | null
  /** COP real, decimal. Una plantilla utility cuesta 3,2 y redondearla la vuelve cero. */
  costoCop?: number
  /** `wamid` en Meta, `SID` en Twilio. */
  idProveedor?: string | null
  proveedor?: string | null
}

/**
 * Lo que devuelve la lectura.
 *
 * `conversacionId` es obligatorio al escribir y nullable al leer, y no es una
 * inconsistencia: borrar un hilo deja sus contactos con NULL para no perder la
 * historia, pero en el momento de registrar siempre hay hilo.
 */
export interface ContactoGuardado
  extends Omit<ContactoNuevo, 'costoCop' | 'cuerpo' | 'conversacionId'> {
  id: string
  cuerpo: string
  costoCop: number
  conversacionId: string | null
}

export async function registrarContacto(
  db: Db,
  tenantId: string,
  contacto: ContactoNuevo,
): Promise<{ id: string }> {
  const [fila] = await db.query<{ id: string }>(
    `INSERT INTO contactos (tenant_id, obligacion_id, deudor_id, conversacion_id, canal,
                            direccion, ocurrido_en, plantilla_id, cuerpo, resultado,
                            motivo_bloqueo, costo_cop, id_proveedor, proveedor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      tenantId,
      contacto.obligacionId,
      contacto.deudorId,
      contacto.conversacionId ?? null,
      contacto.canal,
      contacto.direccion,
      contacto.timestamp,
      contacto.plantillaId ?? null,
      contacto.cuerpo ?? '',
      contacto.resultado,
      contacto.motivoBloqueo ?? null,
      contacto.costoCop ?? 0,
      contacto.idProveedor ?? null,
      contacto.proveedor ?? null,
    ],
  )
  await tocarConversacion(db, tenantId, contacto)

  return { id: fila.id }
}

/**
 * Mantiene las dos marcas de tiempo desnormalizadas de la conversación.
 *
 * `ultimo_mensaje_en` ordena la bandeja y `ultimo_entrante_en` resuelve el
 * sin-leer con una comparación en vez de un COUNT sobre `contactos`. Vive acá y
 * no en un trigger porque el camino de escritura es uno solo: si algún día hay
 * dos, un trigger sería lo correcto, pero hoy sería magia escondida.
 *
 * `GREATEST` ignora los NULL en Postgres, así que sirve tanto para el primer
 * mensaje como para uno que llega desordenado y no debería retroceder el reloj.
 */
async function tocarConversacion(
  db: Db,
  tenantId: string,
  contacto: ContactoNuevo,
): Promise<void> {
  // `LEAST(..., now())` acota el futuro.
  //
  // Un contacto puede tener fecha futura por diseño: el planificador difiere
  // envíos y los deja `encolado` con su fecha de salida. Sin el tope, un envío
  // agendado para mañana fijaría `ultimo_mensaje_en` en mañana, clavaría esa
  // conversación arriba de la bandeja, y como `GREATEST` nunca retrocede, no
  // podría volver a bajar jamás sin un UPDATE a mano.
  const filas = await db.query<{ id: string }>(
    `UPDATE conversaciones
        SET ultimo_mensaje_en  = GREATEST(ultimo_mensaje_en, LEAST($3::timestamptz, now())),
            ultimo_entrante_en = CASE WHEN $4
                                   THEN GREATEST(ultimo_entrante_en, LEAST($3::timestamptz, now()))
                                   ELSE ultimo_entrante_en END
      WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
    [tenantId, contacto.conversacionId, contacto.timestamp, contacto.direccion === 'entrante'],
  )

  // Cero filas significa que el hilo no existe o es de otro tenant. Las dos son
  // bugs, y sin esto se perdían: el contacto quedaba escrito y la bandeja
  // desactualizada, sin que nada lo dijera.
  if (filas.length === 0) {
    throw new Error(
      `conversación ${contacto.conversacionId} inexistente para el tenant ${tenantId}`,
    )
  }
}

interface FilaContacto {
  id: string
  obligacion_id: string
  deudor_id: string
  conversacion_id: string | null
  canal: Canal
  direccion: 'saliente' | 'entrante'
  ocurrido_en: Date
  plantilla_id: string | null
  cuerpo: string
  resultado: ResultadoEnvio
  motivo_bloqueo: string | null
  costo_cop: string
  id_proveedor: string | null
  proveedor: string | null
}

/**
 * `costo_cop` es `numeric` y el driver de Postgres lo entrega como string para
 * no perder precisión. Convertirlo acá y no aguas abajo evita que alguien sume
 * strings y obtenga "3.23.2".
 */
function aContacto(f: FilaContacto): ContactoGuardado {
  return {
    id: f.id,
    obligacionId: f.obligacion_id,
    deudorId: f.deudor_id,
    conversacionId: f.conversacion_id,
    canal: f.canal,
    direccion: f.direccion,
    timestamp: f.ocurrido_en instanceof Date ? f.ocurrido_en.toISOString() : String(f.ocurrido_en),
    plantillaId: f.plantilla_id,
    cuerpo: f.cuerpo,
    resultado: f.resultado,
    motivoBloqueo: f.motivo_bloqueo,
    costoCop: Number(f.costo_cop),
    idProveedor: f.id_proveedor,
    proveedor: f.proveedor,
  }
}

const COLUMNAS = `id, obligacion_id, deudor_id, conversacion_id, canal, direccion,
                  ocurrido_en, plantilla_id, cuerpo, resultado, motivo_bloqueo,
                  costo_cop, id_proveedor, proveedor`

/** Todo el historial del deudor en orden cronológico, bloqueados incluidos. */
export async function contactosDelDeudor(
  db: Db,
  tenantId: string,
  deudorId: string,
): Promise<ContactoGuardado[]> {
  const filas = await db.query<FilaContacto>(
    `SELECT ${COLUMNAS} FROM contactos
      WHERE tenant_id = $1 AND deudor_id = $2
      ORDER BY ocurrido_en ASC`,
    [tenantId, deudorId],
  )
  return filas.map(aContacto)
}
