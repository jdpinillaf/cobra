import { describe, expect, it } from 'vitest'
import { VerificadorDeclarado, crearVerificador } from './verificador'
import { correoBancolombia } from '@/e2e/fixtures'

/**
 * El ataque que esto para: el buzón está abierto a internet, así que quien
 * conozca el alias manda un correo con el `From` del banco y el texto
 * "recibiste una transferencia por $900.000". Lo que no puede falsificar es la
 * firma del dominio.
 */

const BANCO = 'notificacionesbancolombia.com'

const correo = (dkim?: 'valido' | 'invalido' | 'otroDominio' | 'ausente') =>
  correoBancolombia({
    plantilla: 'llaves',
    montoTexto: '100,000.00',
    remitente: 'CARLOS RAMIREZ GOMEZ',
    cuentaUltimos4: '4129',
    fecha: '14/08/26',
    hora: '15:32',
    alias: 'k7f2mq9xz3@in.ponox.co',
    dkim,
  })

describe('VerificadorDeclarado', () => {
  const verificador = new VerificadorDeclarado()

  it('acepta una firma del dominio esperado', async () => {
    expect(await verificador.verificar(correo(), BANCO)).toMatchObject({
      autentico: true,
      dominio: BANCO,
    })
  })

  it('rechaza un correo firmado por otro dominio', async () => {
    // El ataque del §5: el `From` dice Bancolombia, la firma dice otra cosa.
    const resultado = await verificador.verificar(correo('otroDominio'), BANCO)

    expect(resultado.autentico).toBe(false)
    expect(resultado.motivo).toMatch(/no por notificacionesbancolombia/i)
  })

  it('rechaza un correo sin firma', async () => {
    const resultado = await verificador.verificar(correo('ausente'), BANCO)

    expect(resultado.autentico).toBe(false)
    expect(resultado.motivo).toMatch(/no trae firma/i)
  })

  it('rechaza una firma que no cuadra con el cuerpo', async () => {
    // Es lo que pasaría si alguien edita el monto de un correo real.
    const resultado = await verificador.verificar(correo('invalido'), BANCO)

    expect(resultado.autentico).toBe(false)
    expect(resultado.motivo).toMatch(/no verifica/i)
  })

  it('el dominio esperado sale del parámetro, no de una constante', async () => {
    // Va en `tenant_email_senders.dkim_dominio_esperado`: el día que un cliente
    // use otro banco, es config y no un deploy.
    const resultado = await verificador.verificar(correo(), 'otro-banco.com')
    expect(resultado.autentico).toBe(false)
  })
})

describe('crearVerificador', () => {
  it('sin configurar, devuelve el real', async () => {
    // Al revés que `crearProveedores`, y a propósito: el doble acepta cualquier
    // firma declarada, así que un entorno sin configurar con el doble adentro
    // no dejaría de confirmar pagos — confirmaría todos.
    expect(crearVerificador({}).nombre).toBe('mailauth')
  })

  it('devuelve el doble solo si se lo pide explícitamente', () => {
    expect(crearVerificador({ VERIFICADOR_CORREO: 'declarado' }).nombre).toBe('declarado')
  })

  it('se niega a usar el doble en producción', () => {
    expect(() =>
      crearVerificador({ VERIFICADOR_CORREO: 'declarado', NODE_ENV: 'production' }),
    ).toThrow(/ataque/i)
  })
})
