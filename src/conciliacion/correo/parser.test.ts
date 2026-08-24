import { describe, expect, it } from 'vitest'
import { parsearMime } from './mime'
import {
  huellaDelAviso,
  instanteDelAviso,
  normalizarNombre,
  parsearAviso,
} from './parser'
import { correoBancolombia } from '@/e2e/fixtures'

/**
 * Las dos plantillas reales, con sus seis diferencias de formato intactas:
 * orden de remitente y monto, saludo con nombre o sin él, centavos o no, una
 * estrella o dos, año de dos o cuatro dígitos, y la coma antes de "el".
 */

const LLAVES = correoBancolombia({
  plantilla: 'llaves',
  montoTexto: '100,000.00',
  remitente: 'CARLOS RAMIREZ GOMEZ',
  cuentaUltimos4: '4129',
  fecha: '14/08/26',
  hora: '15:32',
  alias: 'k7f2mq9xz3@in.ponox.co',
})

const TRANSFERENCIA = correoBancolombia({
  plantilla: 'transferencia',
  montoTexto: '600,000',
  remitente: 'ANA MARIA PEÑA',
  cuentaUltimos4: '4129',
  fecha: '14/08/2026',
  hora: '09:05',
  alias: 'k7f2mq9xz3@in.ponox.co',
})

const avisoDe = (crudo: string) => parsearAviso(parsearMime(crudo).texto)

describe('parsearAviso', () => {
  it('lee la plantilla de llaves', () => {
    const aviso = avisoDe(LLAVES)

    expect(aviso?.plantilla).toBe('llaves')
    expect(aviso?.montoCentavos).toBe(10_000_000)
    expect(aviso?.remitenteRaw).toBe('CARLOS RAMIREZ GOMEZ')
    expect(aviso?.cuentaUltimos4).toBe('4129')
    // 15:32 en Bogotá son las 20:32 UTC. Sin resolverlo en zona, el aviso
    // quedaría cinco horas corrido y no cruzaría nunca contra el comprobante.
    expect(aviso?.ocurridoEn.toISOString()).toBe('2026-08-14T20:32:00.000Z')
  })

  it('lee la plantilla de transferencia, con el monto antes del remitente', () => {
    const aviso = avisoDe(TRANSFERENCIA)

    expect(aviso?.plantilla).toBe('transferencia')
    expect(aviso?.montoCentavos).toBe(60_000_000)
    expect(aviso?.remitenteRaw).toBe('ANA MARIA PEÑA')
    expect(aviso?.ocurridoEn.toISOString()).toBe('2026-08-14T14:05:00.000Z')
  })

  it('aguanta el año de cuatro dígitos y el de dos', () => {
    expect(avisoDe(LLAVES)?.ocurridoEn.getUTCFullYear()).toBe(2026)
    expect(avisoDe(TRANSFERENCIA)?.ocurridoEn.getUTCFullYear()).toBe(2026)
  })

  it('aguanta una y dos estrellas antes de la cuenta', () => {
    expect(avisoDe(LLAVES)?.cuentaUltimos4).toBe('4129')
    expect(avisoDe(TRANSFERENCIA)?.cuentaUltimos4).toBe('4129')
  })

  it('no se come el "por" del monto dentro del nombre', () => {
    // El fragmento de nombre es perezoso a propósito. Si fuera codicioso,
    // "CARLOS RAMIREZ GOMEZ por $100,000.00 en tu cuenta" entraría entero como
    // remitente y el monto se perdería.
    expect(avisoDe(LLAVES)?.remitenteRaw).not.toContain('por')
  })

  it('lee un nombre con apellido compuesto', () => {
    const aviso = parsearAviso(
      'Hola Adriana, recibiste una transferencia de MARIA PEÑA-LOPEZ por $50,000.00 en tu cuenta *4129 el 14/08/26 a las 15:32.',
    )
    expect(aviso?.remitenteRaw).toBe('MARIA PEÑA-LOPEZ')
    expect(aviso?.remitenteNorm).toBe('MARIA PENA LOPEZ')
  })

  it('lee un nombre con inicial y punto', () => {
    const aviso = parsearAviso(
      'recibiste una transferencia de JOSE A. GOMEZ por $900 en tu cuenta **4129 el 1/9/26 a las 8:05',
    )
    expect(aviso?.remitenteRaw).toBe('JOSE A. GOMEZ')
    expect(aviso?.montoCentavos).toBe(90_000)
  })

  it('encuentra la frase aunque venga partida en varias líneas', () => {
    // El HTML aplanado mete saltos donde el cliente decidió cortar la caja.
    const aviso = parsearAviso(
      'Hola Adriana,\nrecibiste una transferencia de ANA RUIZ\npor $100,000.00 en tu cuenta *4129\nel 14/08/26 a las 15:32.',
    )
    expect(aviso?.montoCentavos).toBe(10_000_000)
  })

  it('devuelve null ante un correo que no es un aviso de ingreso', () => {
    // Ni rechaza ni adivina: quien llama lo manda a cuarentena sin ruido.
    expect(parsearAviso('Tu clave fue cambiada exitosamente.')).toBeNull()
    expect(parsearAviso('')).toBeNull()
  })

  it('devuelve null ante un egreso, que se parece pero no es', () => {
    expect(
      parsearAviso('Realizaste una transferencia por $100,000.00 desde tu cuenta *4129'),
    ).toBeNull()
  })

  it('lanza si la frase matchea pero el monto es ilegible', () => {
    // Distinto de `null`: esto sí tiene que despertar a alguien, porque se
    // parece a un aviso y no se pudo leer.
    expect(() =>
      parsearAviso(
        'recibiste una transferencia de ANA por $1.2.3 en tu cuenta *4129 el 14/08/26 a las 15:32',
      ),
    ).toThrow(/monto/i)
  })

  it('lanza ante una fecha fuera de rango', () => {
    expect(() =>
      parsearAviso(
        'recibiste una transferencia de ANA por $900 en tu cuenta *4129 el 32/13/26 a las 15:32',
      ),
    ).toThrow(/rango/i)
  })
})

describe('normalizarNombre', () => {
  it.each([
    ['ADRIANA PINILLA FERNANDEZ', 'ADRIANA PINILLA FERNANDEZ'],
    ['Adriana Pinilla', 'ADRIANA PINILLA'],
    ['JOSÉ MARÍA GÓMEZ', 'JOSE MARIA GOMEZ'],
    ['PEÑA-LOPEZ', 'PENA LOPEZ'],
    ["D'ANGELO  ROSSI", 'D ANGELO ROSSI'],
  ])('%s → %s', (crudo, esperado) => {
    expect(normalizarNombre(crudo)).toBe(esperado)
  })

  it('conserva la eñe, que no es una tilde', () => {
    // "PEÑA" y "PENA" son dos apellidos distintos, pero el comprobante puede
    // traer cualquiera de los dos: se normalizan al mismo para poder cruzar.
    expect(normalizarNombre('PEÑA')).toBe('PENA')
  })
})

describe('instanteDelAviso', () => {
  it('resuelve la hora de pared de Bogotá', () => {
    expect(instanteDelAviso('14/08/26', '15:32').toISOString()).toBe('2026-08-14T20:32:00.000Z')
  })

  it('el año de dos dígitos es de este siglo', () => {
    expect(instanteDelAviso('01/01/26', '00:00').getUTCFullYear()).toBe(2026)
    expect(instanteDelAviso('01/01/2026', '00:00').getUTCFullYear()).toBe(2026)
  })

  it('un aviso a medianoche no se corre de día', () => {
    // 00:15 en Bogotá siguen siendo las 05:15 UTC del mismo día.
    expect(instanteDelAviso('14/08/26', '00:15').toISOString()).toBe('2026-08-14T05:15:00.000Z')
  })

  it('lanza ante lo que no es una fecha', () => {
    expect(() => instanteDelAviso('ayer', '15:32')).toThrow()
    expect(() => instanteDelAviso('14/08/26', '99:99')).toThrow()
  })
})

describe('huellaDelAviso', () => {
  const base = {
    plantilla: 'llaves',
    montoCentavos: 10_000_000,
    remitenteRaw: 'CARLOS RAMIREZ',
    remitenteNorm: 'CARLOS RAMIREZ',
    cuentaUltimos4: '4129',
    ocurridoEn: new Date('2026-08-14T20:32:00.000Z'),
  }

  it('dos avisos idénticos dan la misma huella', () => {
    // Y por eso el índice no es único: dos pagos reales iguales en el mismo
    // minuto existen, y los dos van a revisión en vez de perderse uno.
    expect(huellaDelAviso(base)).toBe(huellaDelAviso({ ...base }))
  })

  it('cambia con cualquiera de las cuatro señales', () => {
    const huella = huellaDelAviso(base)
    expect(huellaDelAviso({ ...base, montoCentavos: 9_999_999 })).not.toBe(huella)
    expect(huellaDelAviso({ ...base, remitenteNorm: 'OTRO' })).not.toBe(huella)
    expect(huellaDelAviso({ ...base, cuentaUltimos4: '9999' })).not.toBe(huella)
    expect(
      huellaDelAviso({ ...base, ocurridoEn: new Date('2026-08-14T20:33:00.000Z') }),
    ).not.toBe(huella)
  })
})
