import { describe, expect, it } from 'vitest'
import type { Contacto, Deudor, EstadoObligacion, Obligacion } from '@/domain/types'
import { evaluarRespuesta, type Compuerta, type ModoConversacion } from './compuerta'

/**
 * Casos de QA para `evaluarRespuesta`. Archivo nuevo, no toca los existentes.
 *
 * Calendario de referencia (hora de Bogotá):
 *   vie 07 ago 2026 · festivo (Batalla de Boyacá, fijo)
 *   mar 11 ago 2026 · hábil
 *   sáb 15 ago 2026 · NO festivo (Asunción se traslada al lunes 17)
 *   dom 16 ago 2026 · domingo
 *   lun 17 ago 2026 · festivo (Asunción trasladada)
 *   sáb 22 ago 2026 · hábil, ventana 08:00–15:00
 */

const MARTES_10AM = new Date('2026-08-11T10:00:00-05:00')

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
    timestamp: MARTES_10AM.toISOString(),
    plantillaId: 'p1',
    cuerpo: '',
    resultado: 'entregado',
    motivoBloqueo: null,
    costoCop: 3.2,
    idProveedor: 'wamid.0',
    proveedor: 'meta',
    ...over,
  } as Contacto
}

function evaluar(over: {
  ahora?: Date
  deudor?: Deudor
  obligacion?: Obligacion
  contactosDelDeudor?: Contacto[]
  modo?: ModoConversacion
} = {}): Compuerta {
  return evaluarRespuesta({
    ahora: over.ahora ?? MARTES_10AM,
    deudor: over.deudor ?? unDeudor(),
    obligacion: over.obligacion ?? unaObligacion(),
    contactosDelDeudor: over.contactosDelDeudor ?? [],
    modo: over.modo,
  })
}

const conRevocacion = (fecha: string) =>
  unDeudor({
    consentimiento: { otorgado: true, fuente: 'pagare', fecha: '2025-01-15', revocadoEn: fecha },
  })

// ─────────────────────────────────────────────────────────────────────────────
// A1. Producto cartesiano: cada motivo ABSOLUTO × cada modo → siempre 'ley'
// ─────────────────────────────────────────────────────────────────────────────

const ABSOLUTOS: Array<{
  nombre: string
  motivo: string
  over: { deudor?: Deudor; obligacion?: Obligacion }
}> = [
  { nombre: 'referencia', motivo: 'destinatario_es_referencia', over: { deudor: unDeudor({ rol: 'referencia' }) } },
  { nombre: 'opt-out', motivo: 'opt_out', over: { deudor: conRevocacion('2026-08-01T10:00:00-05:00') } },
  {
    nombre: 'sin consentimiento',
    motivo: 'sin_consentimiento',
    over: {
      deudor: unDeudor({
        consentimiento: { otorgado: false, fuente: 'importado', fecha: '2025-01-15', revocadoEn: null },
      }),
    },
  },
  { nombre: 'pagada', motivo: 'obligacion_cerrada', over: { obligacion: unaObligacion({ estado: 'pagada' }) } },
  { nombre: 'juridico', motivo: 'obligacion_cerrada', over: { obligacion: unaObligacion({ estado: 'juridico' }) } },
]

const MODOS: Array<ModoConversacion | undefined> = ['agente', 'humano', undefined]

describe('A1 · motivo absoluto × modo', () => {
  for (const caso of ABSOLUTOS) {
    for (const modo of MODOS) {
      it(`${caso.nombre} con modo=${modo ?? 'sin definir'} → calla por ley (${caso.motivo})`, () => {
        const r = evaluar({ ...caso.over, modo })
        expect(r.responder).toBe(false)
        if (r.responder) return
        expect(r.razon).toBe('ley')
        if (r.razon !== 'ley') return
        expect(r.motivo).toBe(caso.motivo)
      })
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// A2. Producto cartesiano: cada motivo NO absoluto × modo
//     modo agente → responde igual; modo humano → 'pausa', nunca 'ley'
// ─────────────────────────────────────────────────────────────────────────────

const NO_ABSOLUTOS: Array<{
  nombre: string
  motivo: string
  over: { ahora?: Date; deudor?: Deudor; obligacion?: Obligacion; contactosDelDeudor?: Contacto[] }
}> = [
  {
    nombre: 'acuerdo_vigente',
    motivo: 'acuerdo_vigente',
    over: { obligacion: unaObligacion({ estado: 'acuerdo_vigente' }) },
  },
  { nombre: 'domingo', motivo: 'domingo', over: { ahora: new Date('2026-08-16T21:00:00-05:00') } },
  { nombre: 'festivo', motivo: 'festivo', over: { ahora: new Date('2026-08-07T10:00:00-05:00') } },
  {
    nombre: 'fuera de horario legal',
    motivo: 'fuera_de_horario_legal',
    over: { ahora: new Date('2026-08-11T22:00:00-05:00') },
  },
  {
    nombre: 'canal distinto al preferido',
    motivo: 'canal_distinto_al_preferido',
    over: {
      deudor: unDeudor({ preferencia: { canal: 'sms', diaSemana: null, horaDesde: null, horaHasta: null } }),
    },
  },
  {
    nombre: 'día distinto al preferido',
    motivo: 'dia_distinto_al_preferido',
    over: {
      deudor: unDeudor({ preferencia: { canal: null, diaSemana: 3, horaDesde: null, horaHasta: null } }),
    },
  },
  {
    nombre: 'fuera de horario preferido',
    motivo: 'fuera_de_horario_preferido',
    over: {
      deudor: unDeudor({ preferencia: { canal: null, diaSemana: null, horaDesde: 14, horaHasta: null } }),
    },
  },
  {
    nombre: 'límite diario',
    motivo: 'limite_diario',
    over: {
      contactosDelDeudor: [unContacto({ timestamp: '2026-08-11T08:00:00-05:00' })],
    },
  },
  {
    nombre: 'límite semanal',
    motivo: 'limite_semanal',
    over: {
      contactosDelDeudor: [unContacto({ timestamp: '2026-08-08T10:00:00-05:00' })],
    },
  },
]

describe('A2 · motivo NO absoluto × modo', () => {
  for (const caso of NO_ABSOLUTOS) {
    it(`${caso.nombre}: el guard bloquea pero el agente responde (modo agente)`, () => {
      const r = evaluar({ ...caso.over, modo: 'agente' })
      expect(r.decision.permitido).toBe(false)
      if (r.decision.permitido) return
      expect(r.decision.motivo).toBe(caso.motivo)
      expect(r.responder).toBe(true)
    })

    it(`${caso.nombre}: con un asesor encima calla por PAUSA, no por ley`, () => {
      const r = evaluar({ ...caso.over, modo: 'humano' })
      expect(r.responder).toBe(false)
      if (r.responder) return
      expect(r.razon).toBe('pausa')
      // La evidencia de compliance sigue viajando en `decision`, no en `razon`.
      expect(r.decision.permitido).toBe(false)
      expect('motivo' in r).toBe(false)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// A3. `modo` con valores inesperados
// ─────────────────────────────────────────────────────────────────────────────

describe('A3 · modo con valores inesperados', () => {
  const raros = ['Humano', 'HUMANO', 'humano ', 'asesor', '', 'true', null]

  for (const raro of raros) {
    it(`modo=${JSON.stringify(raro)} NO pausa: el agente responde igual`, () => {
      const r = evaluar({ modo: raro as unknown as ModoConversacion })
      // Documenta el comportamiento real: la comparación es estricta contra
      // 'humano', así que cualquier variante silenciosamente deja hablar al bot.
      expect(r.responder).toBe(true)
    })
  }

  it('solo el literal exacto "humano" pausa', () => {
    expect(evaluar({ modo: 'humano' }).responder).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A4. Consentimiento revocado con fechas raras
// ─────────────────────────────────────────────────────────────────────────────

describe('A4 · revocación con fechas raras', () => {
  it('una revocación fechada en el FUTURO ya calla al agente hoy', () => {
    const r = evaluar({ deudor: conRevocacion('2030-01-01T00:00:00-05:00') })
    expect(r.responder).toBe(false)
    if (r.responder || r.razon !== 'ley') return
    expect(r.motivo).toBe('opt_out')
  })

  it('una revocación con string vacío también calla (campo no nulo)', () => {
    const r = evaluar({ deudor: conRevocacion('') })
    expect(r.responder).toBe(false)
    if (r.responder || r.razon !== 'ley') return
    expect(r.motivo).toBe('opt_out')
    // El detalle sale con un hueco: "...el ." No rompe, pero se ve en el panel.
    expect(r.detalle).toContain('el .')
  })

  it('una revocación basura ("no") también calla', () => {
    const r = evaluar({ deudor: conRevocacion('no') })
    expect(r.responder).toBe(false)
  })

  it('revocado gana aunque otorgado siga en true', () => {
    const r = evaluar({
      deudor: unDeudor({
        consentimiento: {
          otorgado: true,
          fuente: 'pagare',
          fecha: '2025-01-15',
          revocadoEn: '2026-08-01T10:00:00-05:00',
        },
      }),
    })
    if (r.responder || r.razon !== 'ley') throw new Error('inalcanzable')
    expect(r.motivo).toBe('opt_out')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A5. La obligación en cada uno de sus estados
// ─────────────────────────────────────────────────────────────────────────────

describe('A5 · cada estado de la obligación', () => {
  const esperado: Record<EstadoObligacion, { responde: boolean; motivo: string | null }> = {
    al_dia: { responde: true, motivo: null },
    en_mora: { responde: true, motivo: null },
    acuerdo_vigente: { responde: true, motivo: 'acuerdo_vigente' },
    pagada: { responde: false, motivo: 'obligacion_cerrada' },
    castigada: { responde: true, motivo: null },
    juridico: { responde: false, motivo: 'obligacion_cerrada' },
  }

  for (const [estado, esp] of Object.entries(esperado) as Array<[EstadoObligacion, { responde: boolean; motivo: string | null }]>) {
    it(`estado=${estado} → ${esp.responde ? 'responde' : 'calla'}`, () => {
      const r = evaluar({ obligacion: unaObligacion({ estado }) })
      expect(r.responder).toBe(esp.responde)
      if (esp.motivo && !r.decision.permitido) {
        expect(r.decision.motivo).toBe(esp.motivo)
      }
    })
  }

  it('`castigada` NO es obligación cerrada: el agente contesta y el guard permite', () => {
    const r = evaluar({ obligacion: unaObligacion({ estado: 'castigada' }) })
    expect(r.responder).toBe(true)
    expect(r.decision.permitido).toBe(true)
  })

  it('`al_dia` deja pasar todo: el guard no mira si hay algo que cobrar', () => {
    const r = evaluar({ obligacion: unaObligacion({ estado: 'al_dia', diasMora: 0, saldoTotal: 0 }) })
    expect(r.decision.permitido).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A6. El rol del destinatario
// ─────────────────────────────────────────────────────────────────────────────

describe('A6 · rol del destinatario', () => {
  it('codeudor responde, aunque el comentario diga "no es el titular"', () => {
    expect(evaluar({ deudor: unDeudor({ rol: 'codeudor' }) }).responder).toBe(true)
  })

  it('deudor solidario responde', () => {
    expect(evaluar({ deudor: unDeudor({ rol: 'solidario' }) }).responder).toBe(true)
  })

  it('la referencia calla incluso si además está fuera de horario', () => {
    const r = evaluar({
      deudor: unDeudor({ rol: 'referencia' }),
      ahora: new Date('2026-08-16T21:00:00-05:00'),
    })
    if (r.responder || r.razon !== 'ley') throw new Error('inalcanzable')
    expect(r.motivo).toBe('destinatario_es_referencia')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A7. Bordes de la ventana legal
// ─────────────────────────────────────────────────────────────────────────────

describe('A7 · bordes exactos de la ventana legal', () => {
  const bordes: Array<[string, string, boolean, string | null]> = [
    ['martes 06:59:59', '2026-08-11T06:59:59-05:00', false, 'fuera_de_horario_legal'],
    ['martes 07:00:00', '2026-08-11T07:00:00-05:00', true, null],
    ['martes 07:00:59', '2026-08-11T07:00:59-05:00', true, null],
    ['martes 18:59:59', '2026-08-11T18:59:59-05:00', true, null],
    ['martes 19:00:00', '2026-08-11T19:00:00-05:00', false, 'fuera_de_horario_legal'],
    ['sábado 07:59:59', '2026-08-22T07:59:59-05:00', false, 'fuera_de_horario_legal'],
    ['sábado 08:00:00', '2026-08-22T08:00:00-05:00', true, null],
    ['sábado 14:59:00', '2026-08-22T14:59:00-05:00', true, null],
    ['sábado 14:59:59', '2026-08-22T14:59:59-05:00', true, null],
    ['sábado 15:00:00', '2026-08-22T15:00:00-05:00', false, 'fuera_de_horario_legal'],
    ['sábado 15:01:00', '2026-08-22T15:01:00-05:00', false, 'fuera_de_horario_legal'],
  ]

  for (const [nombre, iso, permitido, motivo] of bordes) {
    it(`${nombre} → guard ${permitido ? 'permite' : 'bloquea'}`, () => {
      const r = evaluar({ ahora: new Date(iso) })
      expect(r.decision.permitido).toBe(permitido)
      if (!permitido && !r.decision.permitido) expect(r.decision.motivo).toBe(motivo)
      // Pase lo que pase con el guard, la respuesta al entrante sale.
      expect(r.responder).toBe(true)
    })
  }

  it('los segundos no cuentan: 18:59:59 y 19:00:59 caen a lados distintos por el minuto', () => {
    expect(evaluar({ ahora: new Date('2026-08-11T19:00:59-05:00') }).decision.permitido).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A8. Festivos colombianos
// ─────────────────────────────────────────────────────────────────────────────

describe('A8 · festivos colombianos', () => {
  const dias: Array<[string, string, boolean]> = [
    ['viernes 7 ago 2026 (Boyacá, fijo)', '2026-08-07T10:00:00-05:00', true],
    ['sábado 15 ago 2026 (Asunción se traslada, NO es festivo)', '2026-08-15T10:00:00-05:00', false],
    ['lunes 17 ago 2026 (Asunción trasladada)', '2026-08-17T10:00:00-05:00', true],
    ['jueves 1 ene 2026 (Año Nuevo)', '2026-01-01T10:00:00-05:00', true],
    ['viernes 3 abr 2026 (Viernes Santo)', '2026-04-03T10:00:00-05:00', true],
    ['jueves 2 abr 2026 (Jueves Santo)', '2026-04-02T10:00:00-05:00', true],
    ['martes 11 ago 2026 (hábil)', '2026-08-11T10:00:00-05:00', false],
  ]

  for (const [nombre, iso, esFestivo] of dias) {
    it(`${nombre} → guard ${esFestivo ? 'bloquea por festivo' : 'permite'}`, () => {
      const d = evaluar({ ahora: new Date(iso) }).decision
      if (esFestivo) {
        expect(d.permitido).toBe(false)
        if (!d.permitido) expect(d.motivo).toBe('festivo')
      } else {
        expect(d.permitido).toBe(true)
      }
    })
  }

  it('un festivo NO calla al agente: sigue respondiendo el entrante', () => {
    expect(evaluar({ ahora: new Date('2026-08-07T10:00:00-05:00') }).responder).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A9. Límite semanal: ventana móvil y bordes
// ─────────────────────────────────────────────────────────────────────────────

describe('A9 · límite semanal (ventana móvil de 7 días)', () => {
  const HORA = 3_600_000
  const DIA = 86_400_000

  it('exactamente 7 días atrás YA no consume cupo (delta < 7d es estricto)', () => {
    const r = evaluar({
      contactosDelDeudor: [unContacto({ timestamp: new Date(MARTES_10AM.getTime() - 7 * DIA).toISOString() })],
    })
    expect(r.decision.permitido).toBe(true)
  })

  it('6 días 23 h atrás sí consume cupo', () => {
    const r = evaluar({
      contactosDelDeudor: [
        unContacto({ timestamp: new Date(MARTES_10AM.getTime() - (7 * DIA - HORA)).toISOString() }),
      ],
    })
    expect(r.decision.permitido).toBe(false)
    if (r.decision.permitido) return
    expect(r.decision.motivo).toBe('limite_semanal')
  })

  it('un envío AGENDADO a futuro dentro de 7 días también consume cupo', () => {
    const r = evaluar({
      contactosDelDeudor: [
        unContacto({ timestamp: new Date(MARTES_10AM.getTime() + 2 * DIA).toISOString(), resultado: 'encolado' }),
      ],
    })
    expect(r.decision.permitido).toBe(false)
    if (r.decision.permitido) return
    expect(r.decision.motivo).toBe('limite_semanal')
    expect(r.decision.detalle).toContain('agendado')
  })

  it('un `bloqueado` no consume cupo; un `fallido` tampoco', () => {
    for (const resultado of ['bloqueado', 'fallido'] as const) {
      const r = evaluar({
        contactosDelDeudor: [
          unContacto({ timestamp: new Date(MARTES_10AM.getTime() - 2 * DIA).toISOString(), resultado }),
        ],
      })
      expect(r.decision.permitido).toBe(true)
    }
  })

  it('un ENTRANTE del deudor nunca consume cupo, por reciente que sea', () => {
    const r = evaluar({
      contactosDelDeudor: [
        unContacto({ timestamp: new Date(MARTES_10AM.getTime() - 60_000).toISOString(), direccion: 'entrante' }),
      ],
    })
    expect(r.decision.permitido).toBe(true)
  })

  it('el cupo cruza obligaciones: un contacto de OTRO crédito del mismo deudor lo consume', () => {
    const r = evaluar({
      contactosDelDeudor: [
        unContacto({ obligacionId: 'o-otra', timestamp: new Date(MARTES_10AM.getTime() - 2 * DIA).toISOString() }),
      ],
    })
    expect(r.decision.permitido).toBe(false)
  })

  it('el cupo cruza canales: un SMS previo bloquea un whatsapp', () => {
    const r = evaluar({
      contactosDelDeudor: [
        unContacto({ canal: 'sms', timestamp: new Date(MARTES_10AM.getTime() - 2 * DIA).toISOString() }),
      ],
    })
    expect(r.decision.permitido).toBe(false)
  })

  it('con cupo semanal agotado y asesor encima, calla por pausa (no por ley)', () => {
    const r = evaluar({
      modo: 'humano',
      contactosDelDeudor: [unContacto({ timestamp: new Date(MARTES_10AM.getTime() - 2 * DIA).toISOString() })],
    })
    if (r.responder) throw new Error('debería callar')
    expect(r.razon).toBe('pausa')
  })

  it('un timestamp inválido no rompe la evaluación', () => {
    // NaN en las comparaciones: no debería tirar excepción ni bloquear.
    expect(() =>
      evaluar({ contactosDelDeudor: [unContacto({ timestamp: 'no-es-una-fecha' })] }),
    ).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A10. La nota que acompaña a cada rama
// ─────────────────────────────────────────────────────────────────────────────

describe('A10 · la nota que queda escrita', () => {
  it('cuando el guard permite, la nota dice que está dentro de la ventana', () => {
    const r = evaluar()
    if (!r.responder) throw new Error('inalcanzable')
    expect(r.nota).toContain('Dentro de la ventana legal')
  })

  it('cuando el guard bloquea por algo no absoluto, la nota nombra el motivo legible', () => {
    const r = evaluar({ ahora: new Date('2026-08-16T21:00:00-05:00') })
    if (!r.responder) throw new Error('inalcanzable')
    expect(r.nota).toContain('domingo')
    expect(r.nota).not.toContain('_')
  })

  it('el motivo con guiones bajos se ve legible en la nota', () => {
    const r = evaluar({ ahora: new Date('2026-08-11T22:00:00-05:00') })
    if (!r.responder) throw new Error('inalcanzable')
    expect(r.nota).toContain('fuera de horario legal')
  })
})
