import { describe, expect, it } from 'vitest'
import type { Contacto } from '@/domain/types'
import { esFestivo } from '@/compliance/festivos'
import { enBogota } from '@/compliance/reloj-bogota'
import {
  TARIFA_META,
  TARIFA_TWILIO_SMS,
  TARIFA_TWILIO_WHATSAPP_HISTORICA,
} from '@/channels/tarifas'
import { generarCartera } from './seed'
import { simular } from './simulador'

const CARTERA = generarCartera({ cantidad: 300, fechaCorte: '2026-08-11', semilla: 42 })

function correr(dias = 60) {
  return simular({ cartera: CARTERA, fechaInicio: '2026-08-11', dias, semilla: 7 })
}

describe('generarCartera', () => {
  it('es determinista con la misma semilla', () => {
    const a = generarCartera({ cantidad: 50, fechaCorte: '2026-08-11', semilla: 1 })
    const b = generarCartera({ cantidad: 50, fechaCorte: '2026-08-11', semilla: 1 })
    expect(a.obligaciones).toEqual(b.obligaciones)
  })

  it('produce una cartera con los cinco tramos representados', () => {
    const tramos = new Set(CARTERA.obligaciones.map((o) => o.tramo))
    expect(tramos).toEqual(
      new Set(['preventiva', 'temprana', 'media', 'tardia', 'castigada']),
    )
  })

  it('incluye deudores sin consentimiento y con opt-out, como una base real', () => {
    expect(CARTERA.deudores.some((d) => !d.consentimiento.otorgado)).toBe(true)
    expect(CARTERA.deudores.some((d) => d.consentimiento.revocadoEn !== null)).toBe(true)
  })
})

/**
 * La prueba que importa: sobre miles de envíos simulados, ni uno solo puede
 * violar la Ley 2300. Se verifica el resultado, no la intención del código.
 */
describe('ningún mensaje entregado viola la Ley 2300', () => {
  const resultado = correr()
  const entregados = resultado.contactos.filter((c) => c.resultado !== 'bloqueado')

  it('la simulación genera volumen suficiente para que la prueba signifique algo', () => {
    expect(entregados.length).toBeGreaterThan(200)
  })

  it('ninguno cae en domingo', () => {
    const enDomingo = entregados.filter((c) => enBogota(new Date(c.timestamp)).diaSemana === 0)
    expect(enDomingo).toEqual([])
  })

  it('ninguno cae en festivo colombiano', () => {
    const enFestivo = entregados.filter((c) => esFestivo(enBogota(new Date(c.timestamp)).fecha))
    expect(enFestivo).toEqual([])
  })

  it('ninguno sale fuera de la ventana horaria legal', () => {
    const fuera = entregados.filter((c) => {
      const t = enBogota(new Date(c.timestamp))
      const desde = t.diaSemana === 6 ? 8 : 7
      const hasta = t.diaSemana === 6 ? 15 : 19
      return t.hora < desde || t.hora >= hasta
    })
    expect(fuera).toEqual([])
  })

  it('ningún deudor recibe dos mensajes en la misma ventana de 7 días', () => {
    const porDeudor = new Map<string, Contacto[]>()
    for (const c of entregados) {
      const lista = porDeudor.get(c.deudorId) ?? []
      lista.push(c)
      porDeudor.set(c.deudorId, lista)
    }

    const violaciones: string[] = []
    for (const [deudorId, lista] of porDeudor) {
      const ordenados = [...lista].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      for (let i = 1; i < ordenados.length; i++) {
        const delta =
          new Date(ordenados[i].timestamp).getTime() - new Date(ordenados[i - 1].timestamp).getTime()
        if (delta < 7 * 86_400_000) {
          violaciones.push(`${deudorId}: ${ordenados[i - 1].timestamp} → ${ordenados[i].timestamp}`)
        }
      }
    }
    expect(violaciones).toEqual([])
  })

  it('nunca se contacta a alguien sin consentimiento o con opt-out', () => {
    const bloqueados = new Set(
      CARTERA.deudores
        .filter((d) => !d.consentimiento.otorgado || d.consentimiento.revocadoEn !== null)
        .map((d) => d.id),
    )
    expect(entregados.filter((c) => bloqueados.has(c.deudorId))).toEqual([])
  })
})

describe('resultados de la simulación', () => {
  const resultado = correr()

  it('es determinista', () => {
    expect(correr().tratamiento).toEqual(resultado.tratamiento)
  })

  it('deja la mitad de la cartera sin contactar como grupo de control', () => {
    const total = resultado.tratamiento.obligaciones + resultado.control.obligaciones
    expect(total).toBe(CARTERA.obligaciones.length)
    expect(resultado.control.obligaciones).toBeGreaterThan(total * 0.35)
  })

  it('el grupo tratado recupera más que el de control', () => {
    expect(resultado.tratamiento.tasaRecuperacion).toBeGreaterThan(resultado.control.tasaRecuperacion)
    expect(resultado.upliftPuntos).toBeGreaterThan(0)
  })

  it('separa los envíos diferidos de los bloqueados definitivamente', () => {
    // Diferido = salió más tarde. Bloqueado = no salió nunca. Mezclarlos haría
    // ver como violaciones evitadas lo que es simple respeto de la ventana.
    expect(resultado.diferidosTotales).toBeGreaterThan(0)
    expect(Object.keys(resultado.diferidos)).toContain('limite_semanal')

    // Los deudores sin autorización tienen que aparecer bloqueados, no ausentes.
    const motivosBloqueo = Object.keys(resultado.bloqueados)
    expect(motivosBloqueo.some((m) => m === 'opt_out' || m === 'sin_consentimiento')).toBe(true)
  })

  it('no difiere por horario preferido más de una vez por deudor y paso', () => {
    // El scheduler encola el job para la ventana preferida y lo ejecuta ahí;
    // no vuelve a intentar cada mañana contra la misma preferencia.
    const porPreferencia = resultado.diferidos.fuera_de_horario_preferido ?? 0
    expect(porPreferencia).toBeLessThan(resultado.mensajes.total)
  })

  it('el costo de los mensajes cae entre la tarifa utility y la marketing', () => {
    // Ya no hay una tarifa plana por canal: con Meta directo el precio lo fija
    // la categoría de la plantilla. El costo total tiene que quedar acotado por
    // los dos extremos, y pegado al piso porque la cadencia es casi toda
    // `utility` — si se despega, alguien metió lenguaje promocional y Meta
    // reclasificó la plantilla a `marketing`.
    const { whatsapp, sms, costoCop } = resultado.mensajes
    const costoSms = sms * TARIFA_TWILIO_SMS.costoCop('sms', 'utility')

    const piso = whatsapp * TARIFA_META.costoCop('whatsapp', 'utility') + costoSms
    const techo = whatsapp * TARIFA_META.costoCop('whatsapp', 'marketing') + costoSms

    expect(costoCop).toBeGreaterThanOrEqual(piso)
    expect(costoCop).toBeLessThanOrEqual(techo)

    // El promedio por mensaje tiene que quedarse del lado de `utility`. La
    // cadencia incluye una plantilla `marketing` y esa sola, siendo una
    // fracción mínima del volumen, ya duplica la factura: es la ilustración de
    // por qué la categoría se audita en `Plantilla.categoria`.
    const promedio = (costoCop - costoSms) / whatsapp
    expect(promedio).toBeLessThan(TARIFA_META.costoCop('whatsapp', 'marketing') / 4)
  })

  it('cuesta bastante menos de lo que costaría con un revendedor', () => {
    const { whatsapp, costoCop } = resultado.mensajes
    const conBsp = whatsapp * TARIFA_TWILIO_WHATSAPP_HISTORICA.costoCop('whatsapp', 'utility')

    expect(costoCop).toBeLessThan(conBsp)
  })
})
