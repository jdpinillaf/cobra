import { describe, expect, it } from 'vitest'
import type { Contacto, Deudor, Obligacion } from '@/domain/types'
import { evaluar, type Decision, type SolicitudEnvio } from './guard'

/**
 * Calendario de referencia para estos tests (agosto de 2026, hora de Bogotá):
 *   lun 10 · mar 11 · mié 12 · jue 13 · vie 14 · sáb 15 · dom 16
 *   lun 17 = festivo (Asunción, trasladada desde el sábado 15)
 *   sáb 22 = sábado ordinario
 */
const MARTES = (hora: string) => new Date(`2026-08-11T${hora}:00-05:00`)
const SABADO = (hora: string) => new Date(`2026-08-22T${hora}:00-05:00`)
const DOMINGO = (hora: string) => new Date(`2026-08-16T${hora}:00-05:00`)
const LUNES_FESTIVO = (hora: string) => new Date(`2026-08-17T${hora}:00-05:00`)

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
    consentimiento: {
      otorgado: true,
      fuente: 'pagare',
      fecha: '2025-01-15',
      revocadoEn: null,
    },
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
    timestamp: MARTES('10:00').toISOString(),
    plantillaId: 'p1',
    cuerpo: 'Recordatorio de pago',
    resultado: 'entregado',
    motivoBloqueo: null,
    costoCop: 24,
    idProveedor: null,
    proveedor: null,
    ...over,
  }
}

function pedir(over: Partial<SolicitudEnvio> = {}): Decision {
  return evaluar({
    ahora: MARTES('10:00'),
    canal: 'whatsapp',
    deudor: unDeudor(),
    obligacion: unaObligacion(),
    contactosDelDeudor: [],
    ...over,
  })
}

function motivo(d: Decision): string | null {
  return d.permitido ? null : d.motivo
}

describe('caso base', () => {
  it('permite un martes a las 10:00 sin contactos previos', () => {
    expect(pedir().permitido).toBe(true)
  })
})

describe('prohibiciones absolutas', () => {
  it('nunca contacta a una referencia, ni en horario perfecto', () => {
    const d = pedir({ deudor: unDeudor({ rol: 'referencia' }) })
    expect(motivo(d)).toBe('destinatario_es_referencia')
  })

  it.each(['titular', 'codeudor', 'solidario'] as const)('sí contacta al %s', (rol) => {
    expect(pedir({ deudor: unDeudor({ rol }) }).permitido).toBe(true)
  })

  it('el opt-out gana sobre el consentimiento previo', () => {
    const deudor = unDeudor({
      consentimiento: {
        otorgado: true,
        fuente: 'pagare',
        fecha: '2025-01-15',
        revocadoEn: '2026-08-01',
      },
    })
    expect(motivo(pedir({ deudor }))).toBe('opt_out')
  })

  it('sin consentimiento no se envía', () => {
    const deudor = unDeudor({
      consentimiento: { otorgado: false, fuente: 'importado', fecha: '2025-01-15', revocadoEn: null },
    })
    expect(motivo(pedir({ deudor }))).toBe('sin_consentimiento')
  })
})

describe('estado de la obligación', () => {
  it.each([
    ['pagada', 'obligacion_cerrada'],
    ['juridico', 'obligacion_cerrada'],
    ['acuerdo_vigente', 'acuerdo_vigente'],
  ] as const)('bloquea cuando la obligación está %s', (estado, esperado) => {
    expect(motivo(pedir({ obligacion: unaObligacion({ estado }) }))).toBe(esperado)
  })

  it.each(['en_mora', 'al_dia', 'castigada'] as const)('permite cuando está %s', (estado) => {
    expect(pedir({ obligacion: unaObligacion({ estado }) }).permitido).toBe(true)
  })
})

describe('ventana horaria legal', () => {
  it('bloquea los domingos a cualquier hora', () => {
    expect(motivo(pedir({ ahora: DOMINGO('11:00') }))).toBe('domingo')
  })

  it('bloquea los festivos', () => {
    const d = pedir({ ahora: LUNES_FESTIVO('11:00') })
    expect(motivo(d)).toBe('festivo')
  })

  it.each([
    ['06:59', false],
    ['07:00', true],
    ['12:00', true],
    ['18:59', true],
    ['19:00', false],
    ['21:00', false],
  ])('entre semana a las %s → permitido=%s', (hora, permitido) => {
    expect(pedir({ ahora: MARTES(hora) }).permitido).toBe(permitido)
  })

  it.each([
    ['07:59', false],
    ['08:00', true],
    ['14:59', true],
    ['15:00', false],
  ])('sábado a las %s → permitido=%s', (hora, permitido) => {
    expect(pedir({ ahora: SABADO(hora) }).permitido).toBe(permitido)
  })

  it('evalúa en hora de Bogotá, no en la del servidor', () => {
    // 2026-08-12T00:30:00Z son las 19:30 del martes 11 en Bogotá: fuera de ventana.
    const tardeEnBogota = new Date('2026-08-12T00:30:00Z')
    expect(motivo(pedir({ ahora: tardeEnBogota }))).toBe('fuera_de_horario_legal')

    // 2026-08-11T12:00:00Z son las 07:00 del martes 11 en Bogotá: dentro.
    const tempranoEnBogota = new Date('2026-08-11T12:00:00Z')
    expect(pedir({ ahora: tempranoEnBogota }).permitido).toBe(true)
  })
})

describe('preferencias del deudor', () => {
  it('respeta el canal que pidió el deudor', () => {
    const deudor = unDeudor({
      preferencia: { canal: 'sms', diaSemana: null, horaDesde: null, horaHasta: null },
    })
    expect(motivo(pedir({ deudor, canal: 'whatsapp' }))).toBe('canal_distinto_al_preferido')
    expect(pedir({ deudor, canal: 'sms' }).permitido).toBe(true)
  })

  it('respeta el día que pidió el deudor', () => {
    // Pidió que lo contacten los jueves (4); hoy es martes (2).
    const deudor = unDeudor({
      preferencia: { canal: null, diaSemana: 4, horaDesde: null, horaHasta: null },
    })
    expect(motivo(pedir({ deudor }))).toBe('dia_distinto_al_preferido')
  })

  it('la preferencia estrecha la ventana legal', () => {
    const deudor = unDeudor({
      preferencia: { canal: null, diaSemana: null, horaDesde: 14, horaHasta: 17 },
    })
    expect(motivo(pedir({ deudor, ahora: MARTES('10:00') }))).toBe('fuera_de_horario_preferido')
    expect(pedir({ deudor, ahora: MARTES('15:00') }).permitido).toBe(true)
    expect(motivo(pedir({ deudor, ahora: MARTES('17:00') }))).toBe('fuera_de_horario_preferido')
  })

  it('la preferencia NUNCA amplía la ventana legal', () => {
    // Aunque el deudor diga "escríbanme hasta las 22", la ley corta a las 19.
    const deudor = unDeudor({
      preferencia: { canal: null, diaSemana: null, horaDesde: 6, horaHasta: 22 },
    })
    expect(motivo(pedir({ deudor, ahora: MARTES('20:00') }))).toBe('fuera_de_horario_legal')
    expect(motivo(pedir({ deudor, ahora: MARTES('06:30') }))).toBe('fuera_de_horario_legal')
  })

  it('el domingo sigue prohibido aunque el deudor lo pida', () => {
    const deudor = unDeudor({
      preferencia: { canal: null, diaSemana: 6, horaDesde: null, horaHasta: null },
    })
    expect(motivo(pedir({ deudor, ahora: DOMINGO('11:00') }))).toBe('domingo')
  })
})

describe('límite de frecuencia', () => {
  it('bloquea el segundo contacto del mismo día', () => {
    const previo = unContacto({ timestamp: MARTES('08:00').toISOString() })
    const d = pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [previo] })
    expect(motivo(d)).toBe('limite_diario')
  })

  it('cuenta los canales JUNTOS, no por separado', () => {
    // WhatsApp el sábado 15; el SMS del martes 18 sigue dentro de los 7 días.
    const porWhatsapp = unContacto({
      canal: 'whatsapp',
      timestamp: new Date('2026-08-15T09:00:00-05:00').toISOString(),
    })
    const d = evaluar({
      ahora: new Date('2026-08-18T10:00:00-05:00'),
      canal: 'sms',
      deudor: unDeudor(),
      obligacion: unaObligacion(),
      contactosDelDeudor: [porWhatsapp],
    })
    expect(motivo(d)).toBe('limite_semanal')
  })

  it('cuenta contactos de OTRA obligación del mismo deudor', () => {
    // Un deudor con tres créditos no puede recibir tres mensajes en la semana.
    const otroCredito = unContacto({
      obligacionId: 'o2',
      timestamp: new Date('2026-08-08T10:00:00-05:00').toISOString(),
    })
    const d = pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [otroCredito] })
    expect(motivo(d)).toBe('limite_semanal')
  })

  it('un contacto ya agendado a futuro también consume la ventana', () => {
    // El planificador difiere envíos y los deja encolados con su fecha de
    // salida. Si la ventana solo mirara hacia atrás, ese envío no gastaría cupo
    // y el deudor recibiría dos mensajes seguidos.
    const agendado = unContacto({
      resultado: 'encolado',
      timestamp: new Date('2026-08-13T10:00:00-05:00').toISOString(),
    })
    const d = pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [agendado] })
    expect(motivo(d)).toBe('limite_semanal')
    if (!d.permitido) expect(d.detalle).toMatch(/agendado/)
  })

  it('libera a los 7 días exactos', () => {
    const hace7Dias = unContacto({
      timestamp: new Date('2026-08-04T10:00:00-05:00').toISOString(),
    })
    expect(pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [hace7Dias] }).permitido).toBe(true)
  })

  it('sigue bloqueando a los 6 días y 23 horas', () => {
    const casi7Dias = unContacto({
      timestamp: new Date('2026-08-04T11:00:00-05:00').toISOString(),
    })
    expect(motivo(pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [casi7Dias] }))).toBe(
      'limite_semanal',
    )
  })

  it.each(['bloqueado', 'fallido'] as const)('un envío %s no consume cupo', (resultado) => {
    // Si un bloqueo por horario gastara la cuota semanal, un mensaje que nunca
    // salió impediría reintentar durante siete días.
    const previo = unContacto({ resultado, timestamp: MARTES('08:00').toISOString() })
    expect(pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [previo] }).permitido).toBe(true)
  })

  it('los mensajes entrantes del deudor no consumen su cupo', () => {
    const respuesta = unContacto({
      direccion: 'entrante',
      timestamp: MARTES('08:00').toISOString(),
    })
    expect(pedir({ ahora: MARTES('10:00'), contactosDelDeudor: [respuesta] }).permitido).toBe(true)
  })
})

describe('trazabilidad', () => {
  it('todo bloqueo trae motivo y detalle legibles', () => {
    const d = pedir({ ahora: DOMINGO('11:00') })
    expect(d.permitido).toBe(false)
    if (d.permitido) return
    expect(d.motivo).toBeTruthy()
    expect(d.detalle.length).toBeGreaterThan(10)
    expect(d.evaluadoEn.fecha).toBe('2026-08-16')
  })

  it('la decisión registra la hora de Bogotá evaluada', () => {
    const d = pedir({ ahora: new Date('2026-08-11T15:00:00Z') })
    expect(d.evaluadoEn.hora).toBe(10)
    expect(d.evaluadoEn.fecha).toBe('2026-08-11')
    expect(d.evaluadoEn.diaSemana).toBe(2)
  })
})
