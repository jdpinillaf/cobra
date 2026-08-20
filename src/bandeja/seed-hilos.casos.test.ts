import { describe, expect, it } from 'vitest'
import { esFestivo } from '@/compliance/festivos'
import { enBogota } from '@/compliance/reloj-bogota'
import { cop } from '@/lib/formato'
import { generarHilos, GUIONES } from './seed-hilos'
import type { ContextoGuion, HiloSeed, OpcionesHilos } from './seed-hilos'

/**
 * Casos de QA para el seed de conversaciones.
 *
 * El archivo hermano (`seed-hilos.test.ts`) prueba la bandeja "buena": treinta
 * obligaciones, tres usuarios, semilla 7, un jueves a las 3 de la tarde. Acá se
 * intenta lo contrario — entradas degeneradas, ocho semillas, `ahora` en los
 * bordes del calendario colombiano y doscientas obligaciones — para ver cuáles
 * de las invariantes son propiedades del generador y cuáles eran suerte de esa
 * configuración.
 */

// --- Ventana legal, escrita a mano y no importada del generador ---

const VENTANA: ReadonlyArray<readonly [number, number] | null> = [
  null, // domingo
  [7 * 60, 19 * 60],
  [7 * 60, 19 * 60],
  [7 * 60, 19 * 60],
  [7 * 60, 19 * 60],
  [7 * 60, 19 * 60],
  [8 * 60, 15 * 60], // sábado
]

function dentroDeLaLey(iso: string): boolean {
  const t = enBogota(new Date(iso))
  const v = VENTANA[t.diaSemana]
  if (v === null || esFestivo(t.fecha)) return false
  return t.minutosDelDia >= v[0] && t.minutosDelDia < v[1]
}

// --- El verificador de invariantes ---

/**
 * Devuelve la lista de violaciones. Vacía = bandeja sana.
 *
 * Se devuelven strings y no `expect` sueltos a propósito: cuando una semilla
 * rompe algo, quiero ver el hilo, el índice del mensaje y la fecha en el mismo
 * renglón, no un `expected true to be false`.
 */
function violaciones(hilos: HiloSeed[], opciones: OpcionesHilos): string[] {
  const fallas: string[] = []
  const limite = new Date(opciones.ahora).getTime()
  const usuarios = new Set(opciones.usuarios)

  hilos.forEach((h, hi) => {
    const ubic = `hilo ${hi} (${h.guion}, obl ${h.obligacionId})`

    // I10 — el contrato del tipo: `string | null`, nunca `undefined`.
    if (h.asignadaA !== null && typeof h.asignadaA !== 'string') {
      fallas.push(`${ubic}: asignadaA no es string|null, es ${String(h.asignadaA)}`)
    } else if (h.asignadaA !== null && !usuarios.has(h.asignadaA)) {
      fallas.push(`${ubic}: asignadaA=${h.asignadaA} no está en usuarios`)
    }
    for (const u of h.sinLeerPara) {
      if (!usuarios.has(u)) fallas.push(`${ubic}: sinLeerPara tiene un usuario inexistente: ${u}`)
    }
    for (const n of h.notas) {
      if (typeof n.usuarioId !== 'string') {
        fallas.push(`${ubic}: nota con usuarioId ${String(n.usuarioId)}`)
      }
    }

    if (h.mensajes.length === 0) {
      fallas.push(`${ubic}: hilo sin mensajes`)
      return
    }

    // I8 — todo hilo abre con la presentación de la empresa.
    if (h.mensajes[0].direccion !== 'saliente') {
      fallas.push(`${ubic}: el primer mensaje es entrante`)
    }

    let ultimaEntrada = Number.NEGATIVE_INFINITY
    h.mensajes.forEach((m, mi) => {
      const donde = `${ubic} msg ${mi} @ ${m.ocurridoEn}`
      const t = new Date(m.ocurridoEn).getTime()

      // I1 — estrictamente creciente.
      if (mi > 0) {
        const previo = new Date(h.mensajes[mi - 1].ocurridoEn).getTime()
        if (!(t > previo)) {
          fallas.push(`${donde}: no es posterior al anterior (${h.mensajes[mi - 1].ocurridoEn})`)
        }
      }

      // I2 — nada después de `ahora`.
      if (t > limite) fallas.push(`${donde}: posterior a ahora (${opciones.ahora})`)

      // I3/I4 — la Ley 2300 sobre los salientes.
      if (m.direccion === 'saliente') {
        const dentro = dentroDeLaLey(m.ocurridoEn)
        if (m.resultado === 'bloqueado' && dentro) {
          fallas.push(`${donde}: bloqueado pero DENTRO de la ventana legal`)
        }
        if (m.resultado !== 'bloqueado' && !dentro) {
          const b = enBogota(new Date(m.ocurridoEn))
          fallas.push(
            `${donde}: entregado FUERA de la ventana legal (dow=${b.diaSemana} ${b.hora}:${String(b.minuto).padStart(2, '0')} festivo=${esFestivo(b.fecha)})`,
          )
        }
      }

      // I5 — el deudor no se contesta a sí mismo.
      if (mi > 0 && m.direccion === 'entrante' && h.mensajes[mi - 1].direccion === 'entrante') {
        fallas.push(`${donde}: el deudor escribió dos veces seguidas`)
      }

      // I6 — cuerpo vacío solo en bloqueados.
      if (m.resultado !== 'bloqueado' && m.cuerpo.trim() === '') {
        fallas.push(`${donde}: cuerpo vacío sin estar bloqueado`)
      }

      // I7 — el motivo no lo desmiente la fecha.
      if (m.resultado === 'bloqueado' && m.motivoBloqueo === null) {
        fallas.push(`${donde}: bloqueado sin motivo`)
      }
      // I11 — la categoría facturable. Entrante o bloqueado no se cobra; un
      // saliente dentro de las 24 h de la última entrada es `servicio`.
      const esperada =
        m.direccion === 'entrante' || m.resultado === 'bloqueado'
          ? null
          : t - ultimaEntrada < 24 * 60 * 60_000
            ? 'servicio'
            : 'utility'
      if (m.categoria !== esperada) {
        fallas.push(`${donde}: categoria=${String(m.categoria)}, se esperaba ${String(esperada)}`)
      }
      if (m.direccion === 'entrante') ultimaEntrada = t

      if (m.motivoBloqueo !== null) {
        const b = enBogota(new Date(m.ocurridoEn))
        if (m.motivoBloqueo === 'domingo' && b.diaSemana !== 0) {
          fallas.push(`${donde}: motivo domingo pero dow=${b.diaSemana}`)
        }
        if (m.motivoBloqueo === 'festivo' && !esFestivo(b.fecha)) {
          fallas.push(`${donde}: motivo festivo pero ${b.fecha} no lo es`)
        }
        if (m.motivoBloqueo === 'fuera_de_horario_legal' || m.motivoBloqueo === 'limite_semanal') {
          if (b.diaSemana === 0 || esFestivo(b.fecha)) {
            fallas.push(`${donde}: motivo ${m.motivoBloqueo} en domingo/festivo`)
          }
        }
        if (m.direccion === 'entrante') {
          fallas.push(`${donde}: un mensaje entrante trae motivoBloqueo`)
        }
      }
    })

    // I9 — la nota no queda fechada después del hilo que comenta.
    const ultimo = new Date(h.mensajes.at(-1)!.ocurridoEn).getTime()
    for (const n of h.notas) {
      if (new Date(n.ocurridoEn).getTime() > ultimo) {
        fallas.push(`${ubic}: nota (${n.ocurridoEn}) posterior al último mensaje`)
      }
    }
  })

  return fallas
}

// --- Fixtures ---

const EMPRESA = 'Ferretería El Tornillo S.A.S.'
const USUARIOS = ['user-a', 'user-b', 'user-c']
const AHORA = '2026-08-20T15:00:00-05:00' // jueves hábil

const obligacion = (i: number, extra: Partial<OpcionesHilos['obligaciones'][number]> = {}) => ({
  id: `obl-${i}`,
  deudorId: `deu-${i}`,
  deudorNombre: `Deudor ${i}`,
  numeroCredito: `CR-${1000 + i}`,
  saldoTotal: 250_000 + i * 137_000,
  diasMora: i * 7 - 10,
  ...extra,
})

const lote = (n: number) => Array.from({ length: n }, (_, i) => obligacion(i))

const opts = (o: Partial<OpcionesHilos> = {}): OpcionesHilos => ({
  obligaciones: lote(30),
  usuarios: USUARIOS,
  empresa: EMPRESA,
  ahora: AHORA,
  semilla: 7,
  ...o,
})

const correr = (o: Partial<OpcionesHilos> = {}) => {
  const op = opts(o)
  return { op, hilos: generarHilos(op) }
}

// --- 1. Entradas degeneradas ---

describe('casos QA · entradas degeneradas', () => {
  it('caso 1.1 · sin obligaciones devuelve una bandeja vacía, no un crash', () => {
    const { op, hilos } = correr({ obligaciones: [] })
    expect(hilos).toEqual([])
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.2 · una sola obligación produce un hilo coherente', () => {
    const { op, hilos } = correr({ obligaciones: [obligacion(0)] })
    expect(hilos).toHaveLength(1)
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.3 · sin usuarios: asignadaA tiene que ser null, nunca undefined', () => {
    const { op, hilos } = correr({ usuarios: [] })
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.4 · sin usuarios: sinLeerPara queda vacío', () => {
    const { hilos } = correr({ usuarios: [] })
    expect(hilos.every((h) => h.sinLeerPara.length === 0)).toBe(true)
  })

  it('caso 1.5 · sin usuarios no hay notas, porque una nota sin autor no se guarda', () => {
    // El caso original pedía que las notas existieran igual y solo tuvieran
    // autor `string`. No se puede: `notas.usuario_id` referencia a
    // `tenant_usuarios`, así que una nota de un tenant sin equipo no pasa la
    // clave foránea. Lo que estaba mal era el `undefined` que se colaba como
    // autor, no que faltaran notas.
    const { hilos } = correr({ usuarios: [] })
    const notas = hilos.flatMap((h) => h.notas)

    expect(notas).toEqual([])
    expect(hilos.every((h) => h.asignadaA === null)).toBe(true)
  })

  it('caso 1.6 · un solo usuario: todo lo asignado le toca a él', () => {
    const { op, hilos } = correr({ usuarios: ['solo-yo'] })
    expect(violaciones(hilos, op)).toEqual([])
    expect(hilos.every((h) => h.asignadaA === null || h.asignadaA === 'solo-yo')).toBe(true)
  })

  it('caso 1.7 · nombre de una sola palabra no rompe nada', () => {
    const { op, hilos } = correr({
      obligaciones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
        obligacion(i, { deudorNombre: 'Cher' }),
      ),
    })
    expect(violaciones(hilos, op)).toEqual([])
    expect(hilos[0].mensajes[0].cuerpo).toContain('Cher')
  })

  it('caso 1.8 · nombre vacío no produce un saludo mutilado', () => {
    const { hilos } = correr({
      obligaciones: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => obligacion(i, { deudorNombre: '' })),
    })
    const rotos = hilos
      .flatMap((h) => h.mensajes)
      .filter((m) => m.resultado !== 'bloqueado')
      .filter((m) => /(^|[\s,])\.\s/.test(m.cuerpo) || /,\s*\./.test(m.cuerpo))
    expect(rotos.map((m) => m.cuerpo)).toEqual([])
  })

  it('caso 1.9 · nombre vacío igual sostiene todas las invariantes', () => {
    const { op, hilos } = correr({
      obligaciones: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => obligacion(i, { deudorNombre: '' })),
    })
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.10 · nombre solo con espacios', () => {
    const { op, hilos } = correr({
      obligaciones: [0, 1, 2].map((i) => obligacion(i, { deudorNombre: '   ' })),
    })
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.11 · saldo cero no rompe las invariantes', () => {
    const { op, hilos } = correr({
      obligaciones: Array.from({ length: 16 }, (_, i) => obligacion(i, { saldoTotal: 0 })),
    })
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.12 · saldo negativo no debería aparecer como una cuota a pagar', () => {
    const { hilos } = correr({
      obligaciones: Array.from({ length: 16 }, (_, i) => obligacion(i, { saldoTotal: -450_000 })),
    })
    const cuerpos = hilos.flatMap((h) => h.mensajes.map((m) => m.cuerpo)).join('\n')
    // Un link de pago por menos $225.000 es un dato imposible: si el seed lo
    // acepta, la pantalla lo va a dibujar tal cual.
    expect(cuerpos).not.toMatch(/cuotas de -/)
    expect(cuerpos).not.toMatch(/link para pagar -/)
  })

  it('caso 1.13 · saldo negativo no rompe las invariantes de tiempo y ley', () => {
    const { op, hilos } = correr({
      obligaciones: Array.from({ length: 16 }, (_, i) => obligacion(i, { saldoTotal: -450_000 })),
    })
    expect(violaciones(hilos, op)).toEqual([])
  })

  it('caso 1.14 · días de mora negativos se muestran como cero, no como negativos', () => {
    const { hilos } = correr({
      obligaciones: Array.from({ length: 16 }, (_, i) => obligacion(i, { diasMora: -99 })),
    })
    const cuerpos = hilos.flatMap((h) => h.mensajes.map((m) => m.cuerpo)).join('\n')
    expect(cuerpos).not.toContain('-99 días')
    expect(cuerpos).toContain('0 días de mora')
  })

  it('caso 1.15 · un saldo NaN se ve, no se disimula', () => {
    // El caso original pedía que el seed absorbiera `NaN` y no lo mostrara. Se
    // descarta al revés: `saldo_total_centavos` es `bigint NOT NULL`, así que
    // `listarObligaciones` no puede producir un NaN, y si algún día lo hiciera,
    // convertirlo en silencio a "$ 0" mandaría un mensaje de cobro por cero
    // pesos. Un NaN visible es un bug; un cero inventado es una liquidación
    // equivocada que nadie mira.
    //
    // Lo que sí se sanea es el saldo negativo, que sí puede existir y produce
    // un "cuotas de -$225.000" — ver el caso 1.12.
    const { hilos } = correr({
      obligaciones: Array.from({ length: 8 }, (_, i) => obligacion(i, { saldoTotal: Number.NaN })),
    })
    const conNaN = hilos
      .flatMap((h) => h.mensajes.map((m) => m.cuerpo))
      .filter((c) => /NaN/.test(c))
    expect(conNaN.length).toBeGreaterThan(0)
  })

  it('caso 1.16 · obligaciones duplicadas no colapsan en el mismo hilo', () => {
    const dup = Array.from({ length: 6 }, () => obligacion(0))
    const { op, hilos } = correr({ obligaciones: dup })
    expect(hilos).toHaveLength(6)
    expect(violaciones(hilos, op)).toEqual([])
  })
})

// --- 2. Semillas distintas ---

const SEMILLAS = [0, 1, 3, 7, 42, 99, 1234, 31337]

describe('casos QA · las invariantes no dependen de la semilla', () => {
  for (const semilla of SEMILLAS) {
    it(`caso 2.${semilla} · semilla ${semilla} sostiene las nueve invariantes`, () => {
      const { op, hilos } = correr({ semilla })
      expect(violaciones(hilos, op)).toEqual([])
    })
  }

  it('caso 2.a · cada semilla es determinista consigo misma', () => {
    for (const semilla of SEMILLAS) {
      const a = JSON.stringify(generarHilos(opts({ semilla })))
      const b = JSON.stringify(generarHilos(opts({ semilla })))
      expect(a, `semilla ${semilla}`).toBe(b)
    }
  })

  it('caso 2.b · semillas distintas dan bandejas distintas', () => {
    const firmas = new Set(SEMILLAS.map((semilla) => JSON.stringify(generarHilos(opts({ semilla })))))
    expect(firmas.size).toBe(SEMILLAS.length)
  })

  it('caso 2.c · toda semilla produce al menos un intento bloqueado', () => {
    for (const semilla of SEMILLAS) {
      const bloqueados = generarHilos(opts({ semilla })).flatMap((h) =>
        h.mensajes.filter((m) => m.resultado === 'bloqueado'),
      )
      expect(bloqueados.length, `semilla ${semilla} no bloqueó nada`).toBeGreaterThan(0)
    }
  })

  it('caso 2.d · toda semilla usa los ocho guiones', () => {
    for (const semilla of SEMILLAS) {
      const usados = new Set(generarHilos(opts({ semilla })).map((h) => h.guion))
      expect(usados.size, `semilla ${semilla}`).toBe(GUIONES.length)
    }
  })
})

// --- 3. `ahora` en distintos momentos del calendario ---

const MOMENTOS: Array<[string, string]> = [
  ['domingo 15:00', '2026-08-23T15:00:00-05:00'],
  ['festivo (lunes de la Asunción) 15:00', '2026-08-17T15:00:00-05:00'],
  ['festivo (Viernes Santo) 10:00', '2026-04-03T10:00:00-05:00'],
  ['sábado 14:00', '2026-08-22T14:00:00-05:00'],
  ['sábado 15:30 (recién cerrada la ventana)', '2026-08-22T15:30:00-05:00'],
  ['lunes 06:00', '2026-08-24T06:00:00-05:00'],
  ['miércoles 23:00', '2026-08-19T23:00:00-05:00'],
  ['lunes 07:00:01 (apenas abre)', '2026-08-24T07:00:01-05:00'],
  ['1 de enero 09:00 (festivo tras puente)', '2026-01-01T09:00:00-05:00'],
  ['martes de Semana Santa siguiente 06:30', '2026-04-06T06:30:00-05:00'],
]

describe('casos QA · `ahora` en los bordes del calendario', () => {
  for (const [nombre, ahora] of MOMENTOS) {
    it(`caso 3 · ${nombre}`, () => {
      const { op, hilos } = correr({ ahora })
      expect(violaciones(hilos, op)).toEqual([])
    })
  }

  it('caso 3.x · en los bordes, con las ocho semillas, tampoco se rompe', () => {
    const fallas: string[] = []
    for (const [nombre, ahora] of MOMENTOS) {
      for (const semilla of SEMILLAS) {
        const op = opts({ ahora, semilla })
        fallas.push(...violaciones(generarHilos(op), op).map((f) => `[${nombre} s=${semilla}] ${f}`))
      }
    }
    expect(fallas.slice(0, 20)).toEqual([])
  })

  it('caso 3.y · un domingo no deja ningún saliente entregado ese domingo', () => {
    const { hilos } = correr({ ahora: '2026-08-23T15:00:00-05:00' })
    const domingueros = hilos
      .flatMap((h) => h.mensajes)
      .filter((m) => m.direccion === 'saliente' && m.resultado !== 'bloqueado')
      .filter((m) => enBogota(new Date(m.ocurridoEn)).diaSemana === 0)
    expect(domingueros).toEqual([])
  })
})

// --- 4. Cantidades grandes ---

describe('casos QA · volumen', () => {
  it('caso 4.1 · 200 obligaciones terminan y sostienen las invariantes', () => {
    const op = opts({ obligaciones: lote(200) })
    const t0 = performance.now()
    const hilos = generarHilos(op)
    const ms = performance.now() - t0

    expect(hilos).toHaveLength(200)
    expect(violaciones(hilos, op)).toEqual([])
    // Es un seed de desarrollo: si tarda más de 2 s, alguien va a esperar.
    expect(ms, `tardó ${Math.round(ms)} ms`).toBeLessThan(2_000)
  })

  it('caso 4.2 · con 200 obligaciones ningún hilo se dispara de largo', () => {
    const hilos = generarHilos(opts({ obligaciones: lote(200) }))
    const largos = hilos.map((h) => h.mensajes.length)
    expect(Math.max(...largos)).toBeLessThanOrEqual(40)
    expect(Math.min(...largos)).toBeGreaterThanOrEqual(1)
  })

  it('caso 4.3 · con 200 obligaciones ningún hilo empieza antes de dos años atrás', () => {
    // Cada intento de cadencia separa de 3 a 9 días; treinta y cinco turnos
    // pueden mandar el arranque del hilo muy atrás. Un hilo que arranca en 2019
    // no es incómodo, es basura.
    const op = opts({ obligaciones: lote(200) })
    const piso = new Date(op.ahora).getTime() - 2 * 365 * 24 * 60 * 60_000
    const viejos = generarHilos(op)
      .map((h) => h.mensajes[0].ocurridoEn)
      .filter((iso) => new Date(iso).getTime() < piso)
    expect(viejos).toEqual([])
  })
})

// --- 5. Coherencia de los guiones ---

function contextoDe(o: OpcionesHilos['obligaciones'][number], empresa: string): ContextoGuion {
  return {
    nombre: o.deudorNombre.split(' ')[0],
    empresa,
    credito: o.numeroCredito,
    saldo: cop(o.saldoTotal),
    cuota: cop(Math.round(o.saldoTotal / 2)),
    abono: cop(Math.max(50_000, Math.round(o.saldoTotal * 0.2))),
    diasMora: Math.max(0, o.diasMora),
  }
}

describe('casos QA · el guion es lo último que pasa en el hilo', () => {
  const op = opts({ obligaciones: lote(80) })
  const hilos = generarHilos(op)
  const porId = new Map(op.obligaciones.map((o) => [o.id, o]))

  for (const guion of GUIONES) {
    it(`caso 5 · «${guion.id}» aparece completo, en orden, y al final del hilo`, () => {
      const usados = hilos.filter((h) => h.guion === guion.id)
      expect(usados.length, `ningún hilo usa ${guion.id}`).toBeGreaterThan(0)

      for (const h of usados) {
        const ctx = contextoDe(porId.get(h.obligacionId)!, op.empresa)
        const cola = h.mensajes.slice(-guion.turnos.length)

        expect(cola.length, `${h.obligacionId}: hilo más corto que el guion`).toBe(
          guion.turnos.length,
        )

        guion.turnos.forEach((turno, k) => {
          const m = cola[k]
          expect(m.direccion, `${h.obligacionId} turno ${k}: dirección`).toBe(
            turno.de === 'deudor' ? 'entrante' : 'saliente',
          )
          // Un bloqueado no llegó a redactarse: solo se le exige la dirección.
          if (m.resultado !== 'bloqueado') {
            expect(m.cuerpo, `${h.obligacionId} turno ${k}: texto`).toBe(turno.texto(ctx))
          }
        })
      }
    })
  }

  it('caso 5.a · un guion que cierra no tiene nada escrito después', () => {
    for (const h of hilos) {
      const guion = GUIONES.find((g) => g.id === h.guion)!
      if (!guion.cierra) continue
      const ctx = contextoDe(porId.get(h.obligacionId)!, op.empresa)
      const ultimo = h.mensajes.at(-1)!
      const cierre = guion.turnos.at(-1)!
      if (ultimo.resultado !== 'bloqueado') expect(ultimo.cuerpo).toBe(cierre.texto(ctx))
      expect(ultimo.direccion).toBe(cierre.de === 'deudor' ? 'entrante' : 'saliente')
    }
  })

  it('caso 5.b · el estado del hilo es el que el guion declara', () => {
    for (const h of hilos) {
      const guion = GUIONES.find((g) => g.id === h.guion)!
      expect(h.agentePausado, h.obligacionId).toBe(guion.pausa)
      expect(h.marca, h.obligacionId).toBe(guion.marca)
      expect(h.etiquetas, h.obligacionId).toEqual(guion.etiqueta ? [guion.etiqueta] : [])
      expect(h.notas.length, h.obligacionId).toBe(guion.nota ? 1 : 0)
    }
  })

  it('caso 5.c · un hilo pausado siempre tiene dueño', () => {
    for (const h of hilos) {
      if (h.agentePausado) expect(h.asignadaA, h.obligacionId).not.toBeNull()
    }
  })

  it('caso 5.d · el preludio de cadencia nunca deja al deudor hablando solo', () => {
    // Los turnos previos al guion son intentos del agente y rondas
    // deudor+agente. Si el último turno del preludio fuera del deudor y el
    // guion abre con el deudor, quedarían dos entrantes pegados.
    for (const h of hilos) {
      const guion = GUIONES.find((g) => g.id === h.guion)!
      if (guion.turnos[0].de !== 'deudor') continue
      const previo = h.mensajes.at(-guion.turnos.length - 1)
      if (previo) expect(previo.direccion, h.obligacionId).toBe('saliente')
    }
  })

  it('caso 5.e · la frase de apertura del arco no aparece antes en el mismo hilo', () => {
    // RONDAS[1].deudor es, palabra por palabra, el primer turno de «promesa»
    // ('estoy en eso, deme unos días'). Si el preludio mete esa ronda en un hilo
    // de «promesa», el deudor dice dos veces exactamente lo mismo y el agente
    // contesta distinto cada vez: en pantalla se lee como un hilo roto.
    const chocan: string[] = []
    for (const h of hilos) {
      const guion = GUIONES.find((g) => g.id === h.guion)!
      const ctx = contextoDe(porId.get(h.obligacionId)!, op.empresa)
      const arco = guion.turnos.map((t) => t.texto(ctx))
      const preludio = h.mensajes.slice(0, -guion.turnos.length).map((m) => m.cuerpo)
      for (const frase of arco) {
        if (frase !== '' && preludio.includes(frase)) {
          chocan.push(`${h.obligacionId} (${h.guion}): «${frase}» ya estaba en el preludio`)
        }
      }
    }
    expect(chocan).toEqual([])
  })

  it('caso 5.f · el agente no manda dos veces seguidas el mismo texto', () => {
    // Cuatro copias idénticas de la misma plantilla, una detrás de la otra, no
    // es cadencia: en la bandeja se ve como un bug de reintentos.
    const seguidos: string[] = []
    for (const h of hilos) {
      h.mensajes.forEach((m, i) => {
        if (i === 0 || m.cuerpo === '') return
        if (m.cuerpo === h.mensajes[i - 1].cuerpo) {
          seguidos.push(`${h.obligacionId} msg ${i}: «${m.cuerpo.slice(0, 50)}…»`)
        }
      })
    }
    expect(seguidos.slice(0, 10)).toEqual([])
  })

  it('caso 5.h · la etiqueta «no contesta» no va en un hilo donde el deudor contestó', () => {
    // El guion «sin-respuesta» dice de sí mismo «solo salientes». Pero el
    // preludio de cadencia inyecta rondas deudor+agente antes del arco, así que
    // el hilo puede terminar etiquetado «no contesta» con cuatro mensajes del
    // deudor adentro. En la bandeja, el filtro «no contesta» muestra
    // conversaciones que sí contestaron.
    const mentirosos = hilos
      .filter((h) => h.etiquetas.includes('no contesta'))
      .filter((h) => h.mensajes.some((m) => m.direccion === 'entrante'))
      .map((h) => {
        const n = h.mensajes.filter((m) => m.direccion === 'entrante').length
        return `${h.obligacionId}: etiqueta «no contesta» con ${n} entrantes`
      })
    expect(mentirosos.slice(0, 10)).toEqual([])
  })

  it('caso 5.g · una ronda del preludio no se repite dentro del mismo hilo', () => {
    // Distinto de 5.f: acá no importa que estén pegadas. El deudor que dice
    // «cuánto es lo que debo exactamente» tres veces en el mismo hilo, con la
    // misma respuesta cada vez, es el mismo dato imposible que los guiones
    // vinieron a arreglar.
    const repes: string[] = []
    for (const h of hilos) {
      const entrantes = h.mensajes.filter((m) => m.direccion === 'entrante').map((m) => m.cuerpo)
      const vistos = new Set<string>()
      for (const c of entrantes) {
        if (vistos.has(c)) repes.push(`${h.obligacionId} (${h.guion}): el deudor repite «${c}»`)
        vistos.add(c)
      }
    }
    expect(repes.slice(0, 10)).toEqual([])
  })
})

// --- 6. Vocabulario de compliance ---

/** Copiado de `MotivoBloqueo` en `src/compliance/guard.ts`. */
const MOTIVOS_VALIDOS = new Set([
  'destinatario_es_referencia',
  'opt_out',
  'numero_no_corresponde',
  'sin_consentimiento',
  'obligacion_cerrada',
  'acuerdo_vigente',
  'domingo',
  'festivo',
  'fuera_de_horario_legal',
  'canal_distinto_al_preferido',
  'fuera_de_horario_preferido',
  'dia_distinto_al_preferido',
  'limite_diario',
  'limite_semanal',
])

describe('casos QA · el motivo del bloqueo habla el idioma del guard', () => {
  it('caso 6.a · todo motivo sembrado existe en MotivoBloqueo', () => {
    const motivos = new Set<string>()
    for (const semilla of SEMILLAS) {
      for (const h of generarHilos(opts({ semilla }))) {
        for (const m of h.mensajes) if (m.motivoBloqueo) motivos.add(m.motivoBloqueo)
      }
    }
    expect(motivos.size).toBeGreaterThan(0)
    expect([...motivos].filter((m) => !MOTIVOS_VALIDOS.has(m))).toEqual([])
  })

  it('caso 6.b · el seed emite «fuera_de_horario_legal», no «fuera_de_ventana_legal»', () => {
    // El test hermano (seed-hilos.test.ts:232) compara contra
    // `fuera_de_ventana_legal`, que el generador no emite nunca: esa rama del
    // assert está muerta. Este caso deja el nombre real anclado.
    const motivos = new Set(
      SEMILLAS.flatMap((semilla) =>
        generarHilos(opts({ semilla })).flatMap((h) =>
          h.mensajes.map((m) => m.motivoBloqueo).filter((x): x is string => x !== null),
        ),
      ),
    )
    expect(motivos.has('fuera_de_horario_legal')).toBe(true)
    expect(motivos.has('fuera_de_ventana_legal')).toBe(false)
  })
})

// --- 7. Categoría facturable (campo recién agregado en 64af239) ---

describe('casos QA · la categoría facturable del seed', () => {
  it('caso 7.a · ni los entrantes ni los bloqueados se cobran', () => {
    for (const semilla of SEMILLAS) {
      for (const h of generarHilos(opts({ semilla }))) {
        for (const m of h.mensajes) {
          if (m.direccion === 'entrante' || m.resultado === 'bloqueado') {
            expect(m.categoria, `s=${semilla} ${h.obligacionId}`).toBeNull()
          } else {
            expect(m.categoria, `s=${semilla} ${h.obligacionId}`).not.toBeNull()
          }
        }
      }
    }
  })

  it('caso 7.b · un hilo sin ninguna entrada no puede facturar «servicio»', () => {
    // La ventana de servicio solo la abre el deudor. Si nunca escribió, todo
    // saliente es plantilla y se cobra.
    for (const semilla of SEMILLAS) {
      for (const h of generarHilos(opts({ semilla }))) {
        if (h.mensajes.some((m) => m.direccion === 'entrante')) continue
        expect(h.mensajes.every((m) => m.categoria !== 'servicio'), h.obligacionId).toBe(true)
      }
    }
  })

  it('caso 7.c · la apertura siempre es plantilla: nadie escribió antes', () => {
    for (const semilla of SEMILLAS) {
      for (const h of generarHilos(opts({ semilla }))) {
        const primero = h.mensajes[0]
        if (primero.resultado === 'bloqueado') continue
        expect(primero.categoria, `s=${semilla} ${h.obligacionId}`).toBe('utility')
      }
    }
  })

  it('caso 7.d · un intento de cadencia (días después) nunca cae dentro de la ventana', () => {
    // Los huecos de un intento son de 3 a 9 días. Si alguno saliera `servicio`,
    // la cuenta de consumo estaría subestimando el costo real.
    const sospechosos: string[] = []
    for (const h of generarHilos(opts({ obligaciones: lote(80) }))) {
      h.mensajes.forEach((m, i) => {
        if (m.categoria !== 'servicio') return
        const previaEntrada = h.mensajes
          .slice(0, i)
          .reverse()
          .find((x) => x.direccion === 'entrante')
        if (!previaEntrada) {
          sospechosos.push(`${h.obligacionId} msg ${i}: servicio sin entrada previa`)
          return
        }
        const horas =
          (new Date(m.ocurridoEn).getTime() - new Date(previaEntrada.ocurridoEn).getTime()) /
          3_600_000
        if (horas >= 24) sospechosos.push(`${h.obligacionId} msg ${i}: servicio a ${horas.toFixed(1)} h`)
      })
    }
    expect(sospechosos.slice(0, 10)).toEqual([])
  })
})
