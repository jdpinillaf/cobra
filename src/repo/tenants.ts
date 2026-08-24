import { cifrar, descifrar, estaCifrado } from '@/auth/cifrado'
import type { CredencialesWhatsApp } from '@/channels/factory'
import type { Db } from './db'

export type { CredencialesWhatsApp }

/**
 * El comerciante y sus credenciales de canal.
 *
 * `tenants` es la entidad que comparten los dos productos: `capacidades[]` dice
 * si concilia, si cobra o las dos cosas, y las tablas por capacidad cuelgan de
 * ahí. Este archivo se ocupa solo de lo que hace falta para **hablarle a su
 * gente**: de qué número sale el mensaje y con qué token.
 *
 * Por qué existe: hasta ahora el webhook resolvía de qué cliente era cada
 * mensaje por `tenants.phone_number_id`, pero el proveedor que respondía se
 * armaba con `META_PHONE_NUMBER_ID` del entorno — o sea, con un remitente
 * único para todos. Con un cliente no se nota. Con dos vivos en la misma WABA,
 * al deudor del segundo le contesta el número del primero, con el nombre del
 * primero, y la conversación queda partida entre dos hilos que ninguno de los
 * dos clientes puede ver entero.
 */

/**
 * Las credenciales de WhatsApp de un cliente, o `null` si no las cargó.
 *
 * `null` no es un error: un cliente en `borrador` todavía no tiene número, y el
 * llamador decide qué hacer con eso. Lo que sí es un error es tener un token
 * guardado que no se puede usar, y eso lanza.
 */
export async function credencialesWhatsApp(
  db: Db,
  tenantId: string,
): Promise<CredencialesWhatsApp | null> {
  const [fila] = await db.query<{
    phone_number_id: string | null
    waba_id: string | null
    wa_token_cifrado: string | null
  }>(
    `SELECT phone_number_id, waba_id, wa_token_cifrado FROM tenants WHERE id = $1`,
    [tenantId],
  )

  if (!fila?.phone_number_id || !fila.waba_id || !fila.wa_token_cifrado) return null

  if (!estaCifrado(fila.wa_token_cifrado)) {
    // Ruidoso y no "lo uso igual". Un token en claro en la base es justamente
    // lo que esta columna existe para evitar, y usarlo en silencio dejaría el
    // agujero abierto para siempre porque nada volvería a avisar.
    throw new Error(
      `El token de WhatsApp del tenant ${tenantId} está guardado sin cifrar. ` +
        'Volvé a cargarlo con `guardarCredencialesWhatsApp`.',
    )
  }

  return {
    phoneNumberId: fila.phone_number_id,
    wabaId: fila.waba_id,
    accessToken: descifrar(fila.wa_token_cifrado),
  }
}

/**
 * Guarda las credenciales cifrando el token.
 *
 * Es el único camino para escribir esa columna: un `UPDATE` a mano desde un
 * script o desde el panel de Supabase dejaría el token en claro, y
 * `credencialesWhatsApp` lo rechaza a propósito para que se note ese mismo día.
 */
export async function guardarCredencialesWhatsApp(
  db: Db,
  tenantId: string,
  credenciales: CredencialesWhatsApp & { propietario?: 'ponox' | 'cliente' },
): Promise<void> {
  await db.query(
    `UPDATE tenants
        SET phone_number_id  = $2,
            waba_id          = $3,
            wa_token_cifrado = $4,
            wa_propietario   = COALESCE($5, wa_propietario),
            wa_origen_token  = 'system_user'
      WHERE id = $1`,
    [
      tenantId,
      credenciales.phoneNumberId,
      credenciales.wabaId,
      cifrar(credenciales.accessToken),
      credenciales.propietario ?? null,
    ],
  )
}

export interface TenantResumen {
  id: string
  nombre: string
  capacidades: string[]
  estado: string
}

export interface ConfigConciliacion {
  id: string
  nombre: string
  /** Últimos cuatro de la cuenta de recaudo. Valida que el pago fue a la cuenta correcta. */
  cuentaUltimos4: string | null
  cuentaTitular: string | null
  /** Contra quién se exige la firma. Sale de la fila, nunca de una constante. */
  dkimDominioEsperado: string
  /** Direcciones desde las que el banco escribe. Bancolombia ha usado varias. */
  remitentes: Array<{ direccion: string; dkimDominioEsperado: string }>
}

/**
 * El comerciante dueño de un alias de correo.
 *
 * El alias es el discriminador de la ingesta, igual que `phone_number_id` lo es
 * del webhook. Y es impredecible a propósito —`k7f2mq9xz3@in.ponox.co`, no
 * `cliente07@`—: el buzón es catch-all y está abierto a internet, así que un
 * alias adivinable deja que cualquiera llene la base o intente colar un aviso
 * falso.
 *
 * Corre **fuera** de `conTenant`, porque justamente sirve para averiguar qué
 * tenant es. Es el mismo caso que `tenantPorNumero`.
 */
export async function tenantPorAlias(
  db: Db,
  alias: string,
): Promise<ConfigConciliacion | null> {
  const [fila] = await db.query<{
    id: string
    nombre: string
    cuenta_ultimos4: string | null
    cuenta_titular: string | null
    dkim_dominio_esperado: string
  }>(
    `SELECT id, nombre, cuenta_ultimos4, cuenta_titular, dkim_dominio_esperado
       FROM tenants
      WHERE lower(email_alias) = lower($1) AND estado IN ('verificando','activo')`,
    [alias],
  )
  if (!fila) return null

  const remitentes = await db.query<{ direccion: string; dkim_dominio_esperado: string }>(
    `SELECT direccion, dkim_dominio_esperado
       FROM tenant_email_senders
      WHERE tenant_id = $1 AND activo`,
    [fila.id],
  )

  return {
    id: fila.id,
    nombre: fila.nombre,
    cuentaUltimos4: fila.cuenta_ultimos4,
    cuentaTitular: fila.cuenta_titular,
    dkimDominioEsperado: fila.dkim_dominio_esperado,
    remitentes: remitentes.map((r) => ({
      direccion: r.direccion.toLowerCase(),
      dkimDominioEsperado: r.dkim_dominio_esperado,
    })),
  }
}

/** El tenant dueño de un número, que es como el webhook sabe de quién es cada evento. */
export async function tenantPorNumero(
  db: Db,
  phoneNumberId: string,
): Promise<TenantResumen | null> {
  const [fila] = await db.query<{
    id: string
    nombre: string
    capacidades: string[]
    estado: string
  }>(
    `SELECT id, nombre, capacidades, estado
       FROM tenants
      WHERE phone_number_id = $1 AND estado = 'activo'`,
    [phoneNumberId],
  )
  return fila ?? null
}
