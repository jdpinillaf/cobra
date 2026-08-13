import { describe, expect, it } from 'vitest'
import type { Cadencia, Contacto, Deudor, Obligacion } from '@/domain/types'
import { enBogota } from '@/compliance/reloj-bogota'
import {
  calcularTramo,
  consumoDelPeriodo,
  pasosVencidos,
  planificarEnvio,
  type ResultadoPlanificacion,
} from './planificador'

function unDeudor(over: Partial<Deudor> = {}): Deudor {
  return {
    id: 'd1',
    clienteId: 'c1',
    tipoDocumento: 'CC',
    documento: '1020304050',
    nombre: 'Ana Ruiz',
    telefonos: ['+573001112233'],
    email: null,
    rol: 'titular',
    consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: null },
    preferencia: { canal: null, diaSemana: null, horaDesde: null, horaHasta: null },
    ...over,
  }
}

function unaObligacion(over: Partial<Obligacion> = {}): Obligacion {
  return {
    id: 'o1',
    clienteId: 'c1',
    deudorId: 'd1',
    numeroCredito: 'CR-001',
    capital: 1_200_000,
    interesMora: 45_000,
    saldoTotal: 1_245_000,
    fechaVencimiento: '2026-07-20',
    diasMora: 22,
    tramo: 'temprana',
    estado: 'en_mora',
    ...over,
  }
}

function unContacto(over: Partial<Contacto> = {}): Contacto {
  return {
    id: 'k1',
    clienteId: 'c1',
    obligacionId: 'o1',
    deudorId: 'd1',
    canal: 'whatsapp',
    direccion: 'saliente',
    timestamp: '2026-08-11T10:00:00-05:00',
    plantillaId: 'p1',
    cuerpo: '',
    resultado: 'entregado',
    motivoBloqueo: null,
    costoCop: 24,
    idProveedor: null,
    proveedor: null,
    ...over,
  }
}

function planificar(
  desde: string,
  over: { deudor?: Deudor; obligacion?: Obligacion; contactos?: Contacto[] } = {},
): ResultadoPlanificacion {
  return planificarEnvio(
    {
      canal: 'whatsapp',
      deudor: over.deudor ?? unDeudor(),
      obligacion: over.obligacion ?? unaObligacion(),
      contactosDelDeudor: over.contactos ?? [],
    },
    new Date(desde),
  )
}

/** Instante resultante como `YYYY-MM-DD HH:mm` en hora de Bogotá. */
function cuando(r: ResultadoPlanificacion): string {
  if (r.tipo === 'detener') return 'detenido'
  const t = enBogota(r.instante)
  return `${t.fecha} ${String(t.hora).padStart(2, '0')}:${String(t.minuto).padStart(2, '0')}`
}

describe('calcularTramo', () => {
  it.each([
    [-5, 'preventiva'],
    [0, 'preventiva'],
    [1, 'temprana'],
    [30, 'temprana'],
    [31, 'media'],
    [90, 'media'],
    [91, 'tardia'],
    [180, 'tardia'],
    [181, 'castigada'],
    [400, 'castigada'],
  ] as const)('%i días de mora → %s', (dias, esperado) => {
    expect(calcularTramo(dias)).toBe(esperado)
  })
})

describe('pasosVencidos', () => {
  const cadencia: Cadencia = {
    id: 'cad1',
    clienteId: 'c1',
    tramo: 'temprana',
    activa: true,
    pasos: [
      { offsetDias: -3, canal: 'whatsapp', plantillaId: 'p-preaviso', fallbackSms: false },
      { offsetDias: 1, canal: 'whatsapp', plantillaId: 'p-dia1', fallbackSms: true },
      { offsetDias: 8, canal: 'whatsapp', plantillaId: 'p-dia8', fallbackSms: true },
      { offsetDias: 45, canal: 'sms', plantillaId: 'p-dia45', fallbackSms: false },
    ],
  }
  // Vencimiento 2026-07-20 → offsets en 07-17, 07-21, 07-28 y 09-03.

  it('devuelve solo los pasos cuya fecha objetivo ya pasó', () => {
    const vencidos = pasosVencidos(unaObligacion(), cadencia, '2026-08-11', new Set())
    expect(vencidos.map((p) => p.indice)).toEqual([0, 1, 2])
    expect(vencidos.map((p) => p.fechaObjetivo)).toEqual(['2026-07-17', '2026-07-21', '2026-07-28'])
  })

  it('omite los ya ejecutados', () => {
    const vencidos = pasosVencidos(unaObligacion(), cadencia, '2026-08-11', new Set([0, 1]))
    expect(vencidos.map((p) => p.indice)).toEqual([2])
  })

  it('el mismo día de la fecha objetivo ya cuenta como vencido', () => {
    const vencidos = pasosVencidos(unaObligacion(), cadencia, '2026-07-17', new Set())
    expect(vencidos.map((p) => p.indice)).toEqual([0])
  })

  it('una cadencia inactiva no programa nada', () => {
    expect(pasosVencidos(unaObligacion(), { ...cadencia, activa: false }, '2026-08-11', new Set()))
      .toHaveLength(0)
  })
})

describe('planificarEnvio', () => {
  it('envía de inmediato si la ventana está abierta', () => {
    const r = planificar('2026-08-11T10:00:00-05:00')
    expect(r.tipo).toBe('enviar_ahora')
    expect(cuando(r)).toBe('2026-08-11 10:00')
  })

  it('un domingo se corre al lunes a las 07:00', () => {
    // Domingo 23; el lunes 24 es hábil. (El lunes 17 no sirve: es festivo.)
    const r = planificar('2026-08-23T11:00:00-05:00')
    expect(r.tipo).toBe('reprogramar')
    expect(cuando(r)).toBe('2026-08-24 07:00')
  })

  it('un domingo seguido de festivo se corre hasta el martes', () => {
    const r = planificar('2026-08-16T11:00:00-05:00')
    expect(cuando(r)).toBe('2026-08-18 07:00')
  })

  it('un festivo se salta al día hábil siguiente', () => {
    // Lunes 17 de agosto de 2026 es festivo (Asunción trasladada).
    const r = planificar('2026-08-17T06:00:00-05:00')
    expect(r.tipo).toBe('reprogramar')
    expect(cuando(r)).toBe('2026-08-18 07:00')
  })

  it('un viernes por la noche se corre al sábado a las 08:00', () => {
    const r = planificar('2026-08-14T20:00:00-05:00')
    expect(cuando(r)).toBe('2026-08-15 08:00')
  })

  it('un sábado por la tarde salta el domingo y cae en lunes', () => {
    const r = planificar('2026-08-22T16:00:00-05:00')
    expect(cuando(r)).toBe('2026-08-24 07:00')
  })

  it('respeta la ventana preferida del deudor al reprogramar', () => {
    const deudor = unDeudor({
      preferencia: { canal: null, diaSemana: null, horaDesde: 14, horaHasta: 17 },
    })
    const r = planificar('2026-08-11T08:00:00-05:00', { deudor })
    expect(cuando(r)).toBe('2026-08-11 14:00')
  })

  it('tras un contacto reciente espera a que se cumplan los 7 días', () => {
    const previo = unContacto({ timestamp: '2026-08-11T10:00:00-05:00' })
    const r = planificar('2026-08-12T09:00:00-05:00', { contactos: [previo] })
    expect(r.tipo).toBe('reprogramar')
    // El 18 a las 07:00 todavía faltan 3 horas para cumplir la semana móvil.
    expect(cuando(r)).toBe('2026-08-19 07:00')
  })

  it('se detiene ante un opt-out en vez de buscar otra ventana', () => {
    const deudor = unDeudor({
      consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: '2026-08-01' },
    })
    const r = planificar('2026-08-16T11:00:00-05:00', { deudor })
    expect(r).toMatchObject({ tipo: 'detener', motivo: 'opt_out' })
  })

  it('se detiene si la obligación ya se pagó', () => {
    const r = planificar('2026-08-16T11:00:00-05:00', {
      obligacion: unaObligacion({ estado: 'pagada' }),
    })
    expect(r).toMatchObject({ tipo: 'detener', motivo: 'obligacion_cerrada' })
  })

  it('se detiene si el canal del paso no es el que pidió el deudor', () => {
    // Esperar no arregla un canal equivocado.
    const deudor = unDeudor({
      preferencia: { canal: 'sms', diaSemana: null, horaDesde: null, horaHasta: null },
    })
    const r = planificar('2026-08-11T10:00:00-05:00', { deudor })
    expect(r).toMatchObject({ tipo: 'detener', motivo: 'canal_distinto_al_preferido' })
  })

  it('conserva el motivo por el que hubo que esperar', () => {
    const r = planificar('2026-08-23T11:00:00-05:00')
    expect(r).toMatchObject({ tipo: 'reprogramar', motivoDeEspera: 'domingo' })
  })
})

describe('consumoDelPeriodo', () => {
  it('cuenta entrantes y salientes, y descarta los bloqueados', () => {
    const contactos = [
      unContacto({ id: '1', direccion: 'saliente', canal: 'whatsapp', costoCop: 24 }),
      unContacto({ id: '2', direccion: 'entrante', canal: 'whatsapp', costoCop: 20 }),
      unContacto({ id: '3', direccion: 'saliente', canal: 'sms', costoCop: 210 }),
      unContacto({ id: '4', resultado: 'bloqueado', motivoBloqueo: 'domingo', costoCop: 0 }),
    ]
    expect(consumoDelPeriodo(contactos)).toEqual({
      mensajes: 3,
      costoCop: 254,
      porCanal: { whatsapp: 2, sms: 1 },
    })
  })
})
