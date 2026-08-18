import { beforeEach, describe, expect, it } from 'vitest'
import { captura, correoBancolombia } from './fixtures'
import { crearSistema, type Sistema } from './sistema'

/**
 * Los cinco caminos que tienen que funcionar para que el producto exista.
 *
 * Dos de orden (el comprobante y el aviso pueden llegar en cualquier orden),
 * dos de fraude (comprobante inventado y correo falsificado) y uno de
 * idempotencia (Meta reentrega, la gente reenvía).
 *
 * Ninguno prueba una función. Prueban lo que el comerciante y su cliente ven.
 */

const TENANT = {
  nombre: 'Panadería Doña Luz',
  cuentaUltimos4: '4129',
  cuentaTitular: 'ADRIANA PINILLA FERNANDEZ',
  aliasCorreo: 'k7f2mq9xz3@in.ponox.co',
  dkimDominioEsperado: 'notificacionesbancolombia.com',
}

const PAGADOR = '+573001112233'

// $100.000 exactos, en las dos notaciones en que Bancolombia los escribe.
const MONTO_CENTAVOS = 10_000_000
const MONTO_TEXTO_LLAVES = '100,000.00'
const MONTO_TEXTO_TRANSFERENCIA = '100,000'

const avisoDelBanco = (over: Partial<Parameters<typeof correoBancolombia>[0]> = {}) =>
  correoBancolombia({
    plantilla: 'llaves',
    montoTexto: MONTO_TEXTO_LLAVES,
    remitente: 'CARLOS RAMIREZ GOMEZ',
    cuentaUltimos4: TENANT.cuentaUltimos4,
    fecha: '14/08/26',
    hora: '15:32',
    alias: TENANT.aliasCorreo,
    ...over,
  })

const comprobante = (over: Partial<Parameters<typeof captura>[0]> = {}) =>
  captura({
    montoCentavos: MONTO_CENTAVOS,
    remitente: 'Carlos Ramirez',
    ocurridoEn: '2026-08-14T15:32:00-05:00',
    destinoUltimos4: TENANT.cuentaUltimos4,
    ...over,
  })

describe('conciliación de extremo a extremo', () => {
  let sistema: Sistema

  beforeEach(() => {
    sistema = crearSistema({ tenant: TENANT, ventanaMinutos: 15, plazoMinutos: 120 })
  })

  it('concilia cuando el comprobante llega primero y el aviso del banco cuatro minutos después', async () => {
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.1', imagen: comprobante() })

    // Antes del aviso el cliente no puede haber recibido una confirmación: eso
    // es exactamente lo que separa este producto de creerle a una captura.
    expect(sistema.mensajesA(PAGADOR).join(' ')).not.toMatch(/confirmad/i)
    expect(sistema.casos()[0].estado).toBe('esperando')

    await sistema.avanzarReloj(4)
    await sistema.recibirCorreo(avisoDelBanco())

    expect(sistema.casos()[0].estado).toBe('aprobado')
    expect(sistema.casos()[0].montoCentavos).toBe(MONTO_CENTAVOS)
    expect(sistema.mensajesA(PAGADOR).at(-1)).toMatch(/confirmad/i)
  })

  it('concilia cuando el aviso del banco llega primero y el comprobante dos horas después', async () => {
    await sistema.recibirCorreo(avisoDelBanco())
    await sistema.avanzarReloj(120)
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.2', imagen: comprobante() })

    // La ventana se mide entre la hora del banco y la hora que leyó el OCR,
    // nunca contra cuándo el pagador se acordó de mandar la captura.
    expect(sistema.casos()[0].estado).toBe('aprobado')
    expect(sistema.mensajesA(PAGADOR).at(-1)).toMatch(/confirmad/i)
  })

  it('nunca confirma un comprobante que no tiene aviso del banco detrás', async () => {
    await sistema.recibirWhatsApp({
      de: PAGADOR,
      wamid: 'wamid.3',
      imagen: comprobante({ montoCentavos: 90_000_000 }),
    })

    expect(sistema.casos()[0].estado).toBe('esperando')

    // Vencido el plazo escala a revisión humana. No rechaza y no confirma:
    // un pago real cuyo correo se perdió merece que alguien lo mire.
    await sistema.avanzarReloj(121)

    expect(sistema.casos()[0].estado).toBe('revisar')
    expect(sistema.mensajesA(PAGADOR).join(' ')).not.toMatch(/confirmad/i)
    expect(sistema.eventos(sistema.casos()[0].id).map((e) => e.paso)).toContain('escalado')
  })

  it('no concilia dos veces el mismo pago aunque el comprobante se reenvíe', async () => {
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.4', imagen: comprobante() })
    await sistema.recibirCorreo(avisoDelBanco())
    expect(sistema.casos()[0].estado).toBe('aprobado')

    // El pagador reenvía la misma captura. Meta le da un wamid nuevo, así que
    // la idempotencia por wamid no alcanza: lo que protege es que el aviso
    // bancario ya está conciliado.
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.5', imagen: comprobante() })

    expect(sistema.casos().filter((c) => c.estado === 'aprobado')).toHaveLength(1)
    // Y la reentrega del webhook de Meta, con el mismo wamid, no crea nada.
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.4', imagen: comprobante() })
    expect(sistema.casos()).toHaveLength(2)
  })

  it('manda a cuarentena un correo firmado por otro dominio y jamás lo usa para confirmar', async () => {
    await sistema.recibirWhatsApp({ de: PAGADOR, wamid: 'wamid.6', imagen: comprobante() })

    // El ataque del §5: el atacante conoce el alias y manda un correo con el
    // From del banco. Lo que no puede falsificar es la firma del dominio.
    await sistema.recibirCorreo(avisoDelBanco({ dkim: 'otroDominio' }))

    expect(sistema.cuarentena()).toBe(1)
    expect(sistema.casos()[0].estado).toBe('esperando')
    expect(sistema.mensajesA(PAGADOR).join(' ')).not.toMatch(/confirmad/i)
  })
})
