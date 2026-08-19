import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearBaseDePrueba, type BaseDePrueba } from '../prueba'
import { registrarContacto } from './contactos'
import {
  abrirOReutilizar,
  asignar,
  hiloDeConversacion,
  listarBandeja,
  marcarLeida,
  pausarAgente,
  reanudarAgente,
} from './conversaciones'

/**
 * La bandeja.
 *
 * Es la respuesta a "¿por qué dejamos de cobrar desde los celulares de los
 * vendedores?": acá queda registro, hay un dueño por hilo, y nadie se pisa.
 *
 * Dos cosas que estos tests fijan y que no son obvias mirando el esquema:
 * el sin-leer es **por persona** (que Marcela lo haya leído no significa que
 * Andrés lo vio), y el hilo mezcla mensajes con notas internas en una sola
 * línea de tiempo, porque así es como el asesor lo lee.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
const DEUDOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OBLIGACION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const MARCELA = 'cccccccc-1111-4111-8111-cccccccccccc'
const ANDRES = 'dddddddd-1111-4111-8111-dddddddddddd'

describe('bandeja de conversaciones', () => {
  let base: BaseDePrueba

  beforeAll(async () => {
    base = await crearBaseDePrueba()
  })
  afterAll(async () => {
    await base.cerrar()
  })
  beforeEach(async () => {
    await base.limpiar()
    await base.sembrarTenant(TENANT, 'Ferretería El Tornillo')
    await base.sembrarTenant(OTRO, 'Distribuidora Andina')
    await base.sembrarDeudorConObligacion(TENANT, DEUDOR, OBLIGACION)
    await base.sembrarUsuario(TENANT, MARCELA, 'marcela@tornillo.co')
    await base.sembrarUsuario(TENANT, ANDRES, 'andres@tornillo.co')
  })

  const abrir = () =>
    abrirOReutilizar(base.db, TENANT, {
      deudorId: DEUDOR,
      obligacionId: OBLIGACION,
      ahora: '2026-08-20T09:00:00-05:00',
    })

  describe('abrir o reutilizar', () => {
    it('abre un hilo nuevo la primera vez', async () => {
      const { id, nueva } = await abrir()

      expect(nueva).toBe(true)
      expect(id).toBeTruthy()
    })

    it('reutiliza el hilo abierto en vez de crear otro', async () => {
      const primera = await abrir()
      const segunda = await abrir()

      // Un deudor tiene una conversación viva, no una por mensaje. Si cada
      // entrante abriera hilo, la bandeja se vuelve ilegible en un día.
      expect(segunda.id).toBe(primera.id)
      expect(segunda.nueva).toBe(false)
    })

    it('abre uno nuevo si el anterior quedó cerrado', async () => {
      const primera = await abrir()
      await base.db.query(`UPDATE conversaciones SET cerrada_en = now() WHERE id = $1`, [primera.id])

      const segunda = await abrir()

      expect(segunda.id).not.toBe(primera.id)
      expect(segunda.nueva).toBe(true)
    })
  })

  describe('pausa', () => {
    it('pausa y reanuda dejando quién y cuándo', async () => {
      const { id } = await abrir()

      await pausarAgente(base.db, TENANT, id, { usuarioId: MARCELA, motivo: 'lo llamo yo' })
      const [pausada] = await listarBandeja(base.db, TENANT, { usuarioId: MARCELA })
      expect(pausada.agentePausado).toBe(true)
      expect(pausada.motivoPausa).toBe('lo llamo yo')

      await reanudarAgente(base.db, TENANT, id)
      const [activa] = await listarBandeja(base.db, TENANT, { usuarioId: MARCELA })
      expect(activa.agentePausado).toBe(false)
    })
  })

  describe('asignación', () => {
    it('asigna y filtra por dueño', async () => {
      const { id } = await abrir()
      await asignar(base.db, TENANT, id, MARCELA)

      expect(await listarBandeja(base.db, TENANT, { usuarioId: MARCELA, filtro: 'mias' })).toHaveLength(1)
      expect(await listarBandeja(base.db, TENANT, { usuarioId: ANDRES, filtro: 'mias' })).toHaveLength(0)
      expect(await listarBandeja(base.db, TENANT, { usuarioId: ANDRES, filtro: 'sin_asignar' })).toHaveLength(0)
    })

    it('un hilo sin dueño aparece en la cola de sin asignar', async () => {
      await abrir()

      expect(
        await listarBandeja(base.db, TENANT, { usuarioId: MARCELA, filtro: 'sin_asignar' }),
      ).toHaveLength(1)
    })
  })

  describe('sin leer', () => {
    it('es por persona, no por conversación', async () => {
      const { id } = await abrir()
      await registrarContacto(base.db, TENANT, {
        obligacionId: OBLIGACION,
        deudorId: DEUDOR,
        conversacionId: id,
        canal: 'whatsapp',
        direccion: 'entrante',
        timestamp: '2026-08-20T10:00:00-05:00',
        cuerpo: 'ya pagué',
        resultado: 'entregado',
      })

      await marcarLeida(base.db, TENANT, id, MARCELA, '2026-08-20T10:00:01-05:00')

      const deMarcela = await listarBandeja(base.db, TENANT, { usuarioId: MARCELA })
      const deAndres = await listarBandeja(base.db, TENANT, { usuarioId: ANDRES })

      // Que Marcela lo haya leído no significa que Andrés lo vio.
      expect(deMarcela[0].sinLeer).toBe(false)
      expect(deAndres[0].sinLeer).toBe(true)
    })
  })

  describe('el hilo', () => {
    it('mezcla mensajes y notas internas en una sola línea de tiempo', async () => {
      const { id } = await abrir()
      await registrarContacto(base.db, TENANT, {
        obligacionId: OBLIGACION,
        deudorId: DEUDOR,
        conversacionId: id,
        canal: 'whatsapp',
        direccion: 'entrante',
        timestamp: '2026-08-20T10:00:00-05:00',
        cuerpo: 'ya pagué ayer',
        resultado: 'entregado',
      })
      await base.db.query(
        `INSERT INTO notas (tenant_id, conversacion_id, usuario_id, cuerpo, created_at)
         VALUES ($1,$2,$3,'lo llamé, paga el viernes','2026-08-20T10:05:00-05:00')`,
        [TENANT, id, MARCELA],
      )
      await registrarContacto(base.db, TENANT, {
        obligacionId: OBLIGACION,
        deudorId: DEUDOR,
        conversacionId: id,
        canal: 'whatsapp',
        direccion: 'saliente',
        timestamp: '2026-08-20T10:10:00-05:00',
        cuerpo: 'gracias, lo verifico',
        resultado: 'enviado',
      })

      const hilo = await hiloDeConversacion(base.db, TENANT, id)

      // El asesor lee una sola columna, no dos pestañas. La nota va entre los
      // dos mensajes porque ahí ocurrió.
      expect(hilo.map((e) => e.tipo)).toEqual(['mensaje', 'nota', 'mensaje'])
      expect(hilo[1].cuerpo).toContain('paga el viernes')
    })

    it('incluye los intentos bloqueados por ley, que son la evidencia', async () => {
      const { id } = await abrir()
      await registrarContacto(base.db, TENANT, {
        obligacionId: OBLIGACION,
        deudorId: DEUDOR,
        conversacionId: id,
        canal: 'whatsapp',
        direccion: 'saliente',
        timestamp: '2026-08-20T21:00:00-05:00',
        cuerpo: '',
        resultado: 'bloqueado',
        motivoBloqueo: 'fuera_de_ventana_legal',
      })

      const hilo = await hiloDeConversacion(base.db, TENANT, id)

      expect(hilo).toHaveLength(1)
      expect(hilo[0].resultado).toBe('bloqueado')
      expect(hilo[0].motivoBloqueo).toBe('fuera_de_ventana_legal')
    })
  })

  it('no muestra las conversaciones de otro cliente', async () => {
    await abrir()

    expect(await listarBandeja(base.db, OTRO, { usuarioId: MARCELA })).toHaveLength(0)
  })
})
