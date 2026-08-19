import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearBaseDePrueba, type BaseDePrueba } from './prueba'
import { conTenant } from './con-tenant'

/**
 * Casos de QA para `20260820000000_bandeja.sql`.
 *
 * Lo que se prueba acá no es "el SQL corre" sino lo que el esquema promete:
 * un solo hilo abierto por deudor, aislamiento por tenant en las tablas nuevas,
 * dedupe de notificaciones, los CHECK, y qué sobrevive al borrar una persona.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const DEUDOR_A = 'aaaa1111-1111-4111-8111-111111111111'
const OBL_A = 'aaaa2222-2222-4222-8222-222222222222'
const DEUDOR_B = 'bbbb1111-1111-4111-8111-111111111111'
const OBL_B = 'bbbb2222-2222-4222-8222-222222222222'

const USER_A = 'aaaa3333-3333-4333-8333-333333333333'
const USER_A2 = 'aaaa4444-4444-4444-8444-444444444444'
const USER_B = 'bbbb3333-3333-4333-8333-333333333333'

const CONV_A = 'aaaa5555-5555-4555-8555-555555555555'
const CONV_A2 = 'aaaa6666-6666-4666-8666-666666666666'
const CONV_B = 'bbbb5555-5555-4555-8555-555555555555'

describe('bandeja · esquema', () => {
  let base: BaseDePrueba

  const abrirConversacion = (id: string, tenant: string, deudor: string, obl: string, cerradaEn: string | null = null) =>
    base.db.query(
      `INSERT INTO conversaciones (id, tenant_id, deudor_id, obligacion_id, cerrada_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, tenant, deudor, obl, cerradaEn],
    )

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(A, 'Panadería Doña Luz')
    await base.sembrarTenant(B, 'Ferretería El Tornillo')
    await base.sembrarDeudorConObligacion(A, DEUDOR_A, OBL_A)
    await base.sembrarDeudorConObligacion(B, DEUDOR_B, OBL_B)
    await base.sembrarUsuario(A, USER_A, 'marcela@doñaluz.co')
    await base.sembrarUsuario(A, USER_A2, 'andres@doñaluz.co')
    await base.sembrarUsuario(B, USER_B, 'infiltrado@tornillo.co')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // B1. El índice único parcial
  // ───────────────────────────────────────────────────────────────────────────

  describe('B1 · un solo hilo abierto por deudor', () => {
    it('rechaza dos hilos abiertos para el mismo deudor', async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
      await expect(abrirConversacion(CONV_A2, A, DEUDOR_A, OBL_A)).rejects.toThrow(
        /conversacion_abierta_por_deudor|duplicate key/i,
      )
    })

    it('permite uno cerrado + uno abierto', async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A, new Date().toISOString())
      await abrirConversacion(CONV_A2, A, DEUDOR_A, OBL_A)

      const filas = await base.db.query(
        'SELECT count(*)::int AS n FROM conversaciones WHERE deudor_id = $1',
        [DEUDOR_A],
      )
      expect(filas[0]).toMatchObject({ n: 2 })
    })

    it('permite N cerrados históricos + uno abierto', async () => {
      for (let i = 0; i < 3; i += 1) {
        await base.db.query(
          `INSERT INTO conversaciones (tenant_id, deudor_id, obligacion_id, cerrada_en)
           VALUES ($1, $2, $3, now())`,
          [A, DEUDOR_A, OBL_A],
        )
      }
      await expect(abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)).resolves.toBeDefined()
    })

    it('el índice no cruza tenants: A y B pueden tener cada uno su hilo abierto', async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
      await expect(abrirConversacion(CONV_B, B, DEUDOR_B, OBL_B)).resolves.toBeDefined()
    })

    it('reabrir poniendo cerrada_en a NULL vuelve a chocar', async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A, new Date().toISOString())
      await abrirConversacion(CONV_A2, A, DEUDOR_A, OBL_A)

      await expect(
        base.db.query('UPDATE conversaciones SET cerrada_en = NULL WHERE id = $1', [CONV_A]),
      ).rejects.toThrow(/duplicate key|conversacion_abierta_por_deudor/i)
    })

    /**
     * Dos fuentes de verdad para "cerrada": la columna `estado` que agrega esta
     * misma migración, y `cerrada_en`, que es la que mira el índice.
     */
    it('cerrar es poner `cerrada_en`, y no hay una segunda forma de hacerlo', async () => {
      // Estos dos casos documentaban que `conversaciones.estado` y `cerrada_en`
      // podían contradecirse. La columna `estado` se eliminó: nadie la leía ni
      // la escribía, y una fila con estado='cerrada' y cerrada_en NULL seguía
      // ocupando el slot único y apareciendo en la bandeja.
      //
      // Ahora hay una sola fuente de verdad. Este test la defiende: si alguien
      // vuelve a agregar una columna de estado, acá se entera.
      const columnas = await base.db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'conversaciones' AND column_name IN ('estado', 'expira_en')`,
      )
      expect(columnas).toHaveLength(0)

      await base.db.query('UPDATE conversaciones SET cerrada_en = now() WHERE id = $1', [CONV_A])
      const libre = await base.db.query(
        'SELECT id FROM conversaciones WHERE deudor_id = $1 AND cerrada_en IS NULL',
        [DEUDOR_A],
      )
      expect(libre).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // B2. RLS en las tablas nuevas
  // ───────────────────────────────────────────────────────────────────────────

  describe('B2 · RLS en las tablas nuevas', () => {
    beforeEach(async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
      await abrirConversacion(CONV_B, B, DEUDOR_B, OBL_B)
      await base.db.query(
        `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo) VALUES ($1,$2,$3,'secreto de A')`,
        [A, CONV_A, USER_A],
      )
      await base.db.query(
        `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo) VALUES ($1,$2,$3,'secreto de B')`,
        [B, CONV_B, USER_B],
      )
      await base.db.query(
        `INSERT INTO etiquetas (tenant_id, nombre, tono) VALUES ($1,'promesa','entregado'), ($2,'promesa','bloqueado')`,
        [A, B],
      )
      await base.db.query(
        `INSERT INTO lecturas (tenant_id, conversacion_id, usuario_id, leido_hasta) VALUES ($1,$2,$3, now())`,
        [A, CONV_A, USER_A],
      )
      await base.db.query(
        `INSERT INTO lecturas (tenant_id, conversacion_id, usuario_id, leido_hasta) VALUES ($1,$2,$3, now())`,
        [B, CONV_B, USER_B],
      )
      await base.db.query(
        `INSERT INTO notificaciones (tenant_id, usuario_id, conversacion_id, tipo, clave_dedupe)
         VALUES ($1,$2,$3,'asignacion','k1')`,
        [A, USER_A, CONV_A],
      )
      await base.db.query(
        `INSERT INTO notificaciones (tenant_id, usuario_id, conversacion_id, tipo, clave_dedupe)
         VALUES ($1,$2,$3,'asignacion','k1')`,
        [B, USER_B, CONV_B],
      )
      await base.db.query(
        `INSERT INTO sesiones (tenant_id, usuario_id, expira_en) VALUES ($1,$2, now() + interval '1 day')`,
        [A, USER_A],
      )
      await base.db.query(
        `INSERT INTO sesiones (tenant_id, usuario_id, expira_en) VALUES ($1,$2, now() + interval '1 day')`,
        [B, USER_B],
      )
    })

    const TABLAS = ['notas', 'etiquetas', 'lecturas', 'notificaciones', 'sesiones'] as const

    for (const tabla of TABLAS) {
      it(`${tabla}: un SELECT sin filtro solo ve las filas de su tenant`, async () => {
        const filas = await base.comoTenant<{ tenant_id: string }>(A, `SELECT tenant_id FROM ${tabla}`)
        expect(filas).toHaveLength(1)
        expect(filas[0].tenant_id).toBe(A)
      })

      it(`${tabla}: no se puede insertar con el tenant_id de otro`, async () => {
        const sql: Record<string, string> = {
          notas: `INSERT INTO notas (tenant_id, conversacion_id, cuerpo) VALUES ('${B}','${CONV_B}','inyectada')`,
          etiquetas: `INSERT INTO etiquetas (tenant_id, nombre) VALUES ('${B}','inyectada')`,
          lecturas: `INSERT INTO lecturas (tenant_id, conversacion_id, usuario_id, leido_hasta) VALUES ('${B}','${CONV_B}','${USER_B}', now())`,
          notificaciones: `INSERT INTO notificaciones (tenant_id, usuario_id, tipo, clave_dedupe) VALUES ('${B}','${USER_B}','x','inyectada')`,
          sesiones: `INSERT INTO sesiones (tenant_id, usuario_id, expira_en) VALUES ('${B}','${USER_B}', now())`,
        }
        await expect(base.comoTenant(A, sql[tabla])).rejects.toThrow(/row-level security|política|policy/i)
      })

      it(`${tabla}: un UPDATE sin filtro no toca las filas de otro tenant`, async () => {
        await base.comoTenant(A, `UPDATE ${tabla} SET tenant_id = tenant_id`)
        const deB = await base.db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${tabla} WHERE tenant_id = $1`,
          [B],
        )
        expect(deB[0].n).toBe(1)
      })

      it(`${tabla}: un DELETE sin WHERE no borra lo de otro tenant`, async () => {
        await base.comoTenant(A, `DELETE FROM ${tabla}`)
        const restantes = await base.db.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${tabla}`)
        expect(restantes).toHaveLength(1)
        expect(restantes[0].tenant_id).toBe(B)
      })
    }

    it('conversacion_etiquetas también aísla', async () => {
      const etiquetaB = await base.db.query<{ id: string }>(
        'SELECT id FROM etiquetas WHERE tenant_id = $1',
        [B],
      )
      await base.db.query(
        'INSERT INTO conversacion_etiquetas (tenant_id, conversacion_id, etiqueta_id) VALUES ($1,$2,$3)',
        [B, CONV_B, etiquetaB[0].id],
      )
      expect(await base.comoTenant(A, 'SELECT * FROM conversacion_etiquetas')).toHaveLength(0)
    })

    it('conTenant() da el mismo aislamiento que comoTenant()', async () => {
      const filas = await conTenant(base.db, A, (tx) => tx.query('SELECT cuerpo FROM notas'))
      expect(filas).toHaveLength(1)
      expect(filas[0]).toMatchObject({ cuerpo: 'secreto de A' })
    })

    it('sin app.tenant_id fijado, no se ve nada (falla cerrado)', async () => {
      // `current_setting(..., true)` da NULL y `tenant_id = NULL` nunca es true.
      const filas = await base.comoTenant('00000000-0000-4000-8000-000000000000', 'SELECT * FROM notas')
      expect(filas).toHaveLength(0)
    })

    /**
     * Nada en el esquema ata `conversacion_id` al mismo tenant que la fila: la
     * FK apunta solo a `conversaciones(id)` y las FK se chequean saltando RLS.
     */
    it('el tenant A no puede colgar una nota de una conversación del tenant B', async () => {
      // La base lo rechaza por llave foránea compuesta (tenant_id, conversacion_id).
      // RLS no alcanzaba: valida el tenant_id de la fila que se inserta, no el
      // de la fila referenciada.
      await expect(
        base.comoTenant(
          A,
          `INSERT INTO notas (tenant_id, conversacion_id, cuerpo) VALUES ('${A}','${CONV_B}','nota cruzada')`,
        ),
      ).rejects.toThrow(/foreign key/i)

      const cruzadas = await base.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM notas n JOIN conversaciones c ON c.id = n.conversacion_id WHERE n.tenant_id <> c.tenant_id',
      )
      expect(cruzadas[0].n).toBe(0)
    })

    it('no se puede crear una sesión del tenant A para un usuario del tenant B', async () => {
      // Era el hallazgo más grave del lote: el tenant sale de la sesión y el
      // usuario de otra tabla, así que una sesión cruzada es escalada de
      // privilegios, no solo un dato mal puesto.
      await expect(
        base.comoTenant(
          A,
          `INSERT INTO sesiones (tenant_id, usuario_id, expira_en) VALUES ('${A}','${USER_B}', now() + interval '1 day')`,
        ),
      ).rejects.toThrow(/foreign key/i)

      const cruzadas = await base.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM sesiones s JOIN tenant_usuarios u ON u.id = s.usuario_id WHERE s.tenant_id <> u.tenant_id',
      )
      expect(cruzadas[0].n).toBe(0)
    })

    it('no se puede notificar a un usuario de otro tenant', async () => {
      await expect(base.comoTenant(
        A,
        `INSERT INTO notificaciones (tenant_id, usuario_id, tipo, clave_dedupe) VALUES ('${A}','${USER_B}','asignacion','cruzada')`,
      )).rejects.toThrow(/foreign key/i)
      const cruzadas = await base.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM notificaciones n JOIN tenant_usuarios u ON u.id = n.usuario_id WHERE n.tenant_id <> u.tenant_id',
      )
      expect(cruzadas[0].n).toBe(0)
    })

    it('no se puede asignar una conversación a un usuario de otro tenant', async () => {
      await expect(
        base.comoTenant(A, `UPDATE conversaciones SET asignada_a = '${USER_B}' WHERE id = '${CONV_A}'`),
      ).rejects.toThrow(/foreign key/i)

      const cruzadas = await base.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM conversaciones c JOIN tenant_usuarios u ON u.id = c.asignada_a WHERE c.tenant_id <> u.tenant_id',
      )
      expect(cruzadas[0].n).toBe(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // B3. Dedupe de notificaciones
  // ───────────────────────────────────────────────────────────────────────────

  describe('B3 · dedupe de notificaciones', () => {
    beforeEach(async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
    })

    const notificar = (usuario: string, clave: string, tipo = 'asignacion', conv: string | null = CONV_A) =>
      base.db.query(
        `INSERT INTO notificaciones (tenant_id, usuario_id, conversacion_id, tipo, clave_dedupe)
         VALUES ($1,$2,$3,$4,$5)`,
        [A, usuario, conv, tipo, clave],
      )

    it('la misma clave para el mismo usuario no entra dos veces', async () => {
      await notificar(USER_A, 'conv:1:asignada')
      await expect(notificar(USER_A, 'conv:1:asignada')).rejects.toThrow(/duplicate key|unique/i)
    })

    it('la misma clave para OTRO usuario sí entra: el aviso es por persona', async () => {
      await notificar(USER_A, 'conv:1:asignada')
      await expect(notificar(USER_A2, 'conv:1:asignada')).resolves.toBeDefined()
    })

    it('la misma clave con otro `tipo` NO entra: el tipo no participa del dedupe', async () => {
      await notificar(USER_A, 'conv:1', 'asignacion')
      await expect(notificar(USER_A, 'conv:1', 'mencion')).rejects.toThrow(/duplicate key|unique/i)
    })

    it('la misma clave en otro tenant sí entra', async () => {
      await notificar(USER_A, 'conv:1:asignada')
      await abrirConversacion(CONV_B, B, DEUDOR_B, OBL_B)
      await expect(
        base.db.query(
          `INSERT INTO notificaciones (tenant_id, usuario_id, conversacion_id, tipo, clave_dedupe)
           VALUES ($1,$2,$3,'asignacion','conv:1:asignada')`,
          [B, USER_B, CONV_B],
        ),
      ).resolves.toBeDefined()
    })

    it('clave_dedupe vacía sigue siendo una clave: el segundo aviso vacío se rechaza', async () => {
      await notificar(USER_A, '')
      await expect(notificar(USER_A, '')).rejects.toThrow(/duplicate key|unique/i)
    })

    it('clave_dedupe es NOT NULL', async () => {
      await expect(
        base.db.query(
          `INSERT INTO notificaciones (tenant_id, usuario_id, tipo, clave_dedupe) VALUES ($1,$2,'x',NULL)`,
          [A, USER_A],
        ),
      ).rejects.toThrow(/null value|not-null/i)
    })

    it('`tipo` no tiene CHECK: acepta cualquier string inventado', async () => {
      await expect(notificar(USER_A, 'k', 'lo-que-sea-🙂')).resolves.toBeDefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // B4. Los CHECK
  // ───────────────────────────────────────────────────────────────────────────

  describe('B4 · CHECK de tono y estado', () => {
    it('etiquetas.tono rechaza un color inventado', async () => {
      await expect(
        base.db.query(`INSERT INTO etiquetas (tenant_id, nombre, tono) VALUES ($1,'urgente','rojo')`, [A]),
      ).rejects.toThrow(/check constraint|etiquetas_tono/i)
    })

    it('etiquetas.tono acepta los cuatro válidos', async () => {
      for (const tono of ['entregado', 'diferido', 'bloqueado', 'neutro']) {
        await expect(
          base.db.query(`INSERT INTO etiquetas (tenant_id, nombre, tono) VALUES ($1,$2,$3)`, [A, `e-${tono}`, tono]),
        ).resolves.toBeDefined()
      }
    })

    it('etiquetas.tono es sensible a mayúsculas: "Neutro" se rechaza', async () => {
      await expect(
        base.db.query(`INSERT INTO etiquetas (tenant_id, nombre, tono) VALUES ($1,'x','Neutro')`, [A]),
      ).rejects.toThrow(/check constraint/i)
    })

    it('etiquetas.tono por defecto es neutro', async () => {
      await base.db.query(`INSERT INTO etiquetas (tenant_id, nombre) VALUES ($1,'sin-tono')`, [A])
      const [fila] = await base.db.query<{ tono: string }>(
        `SELECT tono FROM etiquetas WHERE nombre = 'sin-tono'`,
      )
      expect(fila.tono).toBe('neutro')
    })

    it('etiquetas: dos tenants pueden usar el mismo nombre', async () => {
      await base.db.query(`INSERT INTO etiquetas (tenant_id, nombre) VALUES ($1,'promesa')`, [A])
      await expect(
        base.db.query(`INSERT INTO etiquetas (tenant_id, nombre) VALUES ($1,'promesa')`, [B]),
      ).resolves.toBeDefined()
    })

    it('etiquetas: el mismo nombre dos veces en el mismo tenant se rechaza', async () => {
      await base.db.query(`INSERT INTO etiquetas (tenant_id, nombre) VALUES ($1,'promesa')`, [A])
      await expect(
        base.db.query(`INSERT INTO etiquetas (tenant_id, nombre) VALUES ($1,'promesa')`, [A]),
      ).rejects.toThrow(/duplicate key|unique/i)
    })


    it('motivo_pausa no tiene CHECK ni exige agente_pausado: se puede pausar sin motivo y motivar sin pausa', async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
      await expect(
        base.db.query(
          `UPDATE conversaciones SET agente_pausado = false, motivo_pausa = 'un asesor tomó el hilo', pausada_en = now()
           WHERE id = $1`,
          [CONV_A],
        ),
      ).resolves.toBeDefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // B5. Borrar una persona del equipo
  // ───────────────────────────────────────────────────────────────────────────

  describe('B5 · borrar un tenant_usuario', () => {
    beforeEach(async () => {
      await abrirConversacion(CONV_A, A, DEUDOR_A, OBL_A)
      await base.db.query(
        `UPDATE conversaciones
            SET asignada_a = $2, asignada_en = now(),
                agente_pausado = true, pausada_por = $2, pausada_en = now(),
                motivo_pausa = 'la tomó Marcela'
          WHERE id = $1`,
        [CONV_A, USER_A],
      )
      await base.db.query(
        `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo)
         VALUES ($1,$2,$3,'llamó y quedó de pagar el viernes')`,
        [A, CONV_A, USER_A],
      )
      await base.db.query(
        `INSERT INTO lecturas (tenant_id, conversacion_id, usuario_id, leido_hasta) VALUES ($1,$2,$3, now())`,
        [A, CONV_A, USER_A],
      )
      await base.db.query(
        `INSERT INTO notificaciones (tenant_id, usuario_id, conversacion_id, tipo, clave_dedupe)
         VALUES ($1,$2,$3,'asignacion','k')`,
        [A, USER_A, CONV_A],
      )
      await base.db.query(
        `INSERT INTO sesiones (tenant_id, usuario_id, expira_en) VALUES ($1,$2, now() + interval '1 day')`,
        [A, USER_A],
      )
      await base.db.query('DELETE FROM tenant_usuarios WHERE id = $1', [USER_A])
    })

    it('la nota sobrevive, pero se queda sin autor', async () => {
      const [nota] = await base.db.query<{ cuerpo: string; usuario_id: string | null }>(
        'SELECT cuerpo, usuario_id FROM notas',
      )
      expect(nota.cuerpo).toContain('pagar el viernes')
      expect(nota.usuario_id).toBeNull()
    })

    it('la conversación no se borra: queda sin asignar', async () => {
      const [conv] = await base.db.query<{ asignada_a: string | null; asignada_en: string | null }>(
        'SELECT asignada_a, asignada_en FROM conversaciones WHERE id = $1',
        [CONV_A],
      )
      expect(conv.asignada_a).toBeNull()
      // `asignada_en` no se limpia: queda una fecha de asignación sin asignado.
      expect(conv.asignada_en).not.toBeNull()
    })

    it('sigue pausada aunque el asesor que la pausó ya no exista', async () => {
      const [conv] = await base.db.query<{ agente_pausado: boolean; pausada_por: string | null; motivo_pausa: string }>(
        'SELECT agente_pausado, pausada_por, motivo_pausa FROM conversaciones WHERE id = $1',
        [CONV_A],
      )

      // QA propuso lo contrario: que borrar al usuario despause al agente.
      // Rechazado. Alguien frenó al bot por una razón — deudor en disputa, caso
      // que se está manejando por teléfono — y esa razón no desaparece porque
      // esa persona se fue de la empresa. Reanudar solo se pondría a escribirle
      // a un deudor que una persona protegió a propósito, y en silencio.
      //
      // El problema real que QA detectó sí existe: una pausa sin dueño es
      // invisible. Se resuelve en la bandeja, mostrándola, no despausando.
      // Y a un usuario con historia se lo desactiva (`activo = false`), no se
      // lo borra: para eso existe la columna.
      expect(conv.agente_pausado).toBe(true)
      expect(conv.pausada_por).toBeNull()
      expect(conv.motivo_pausa).not.toBeNull()
    })

    it('las lecturas se borran en cascada', async () => {
      const filas = await base.db.query('SELECT * FROM lecturas')
      expect(filas).toHaveLength(0)
    })

    it('las notificaciones se borran en cascada', async () => {
      const filas = await base.db.query('SELECT * FROM notificaciones')
      expect(filas).toHaveLength(0)
    })

    it('las sesiones se borran en cascada: sacar a alguien lo desloguea', async () => {
      const filas = await base.db.query('SELECT * FROM sesiones')
      expect(filas).toHaveLength(0)
    })

    it('borrar el tenant se lleva todo lo de la bandeja', async () => {
      await base.db.query('DELETE FROM tenants WHERE id = $1', [A])
      for (const tabla of ['notas', 'etiquetas', 'lecturas', 'notificaciones', 'sesiones', 'conversaciones']) {
        const filas = await base.db.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM ${tabla} WHERE tenant_id = $1`,
          [A],
        )
        expect(filas, tabla).toHaveLength(0)
      }
    })
  })
})
