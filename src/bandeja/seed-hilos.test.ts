import { describe, expect, it } from 'vitest'
import { esFestivo } from '@/compliance/festivos'
import { enBogota } from '@/compliance/reloj-bogota'
import { generarHilos, GUIONES } from './seed-hilos'

/**
 * El seed de conversaciones.
 *
 * Existe para poder construir la bandeja antes de que el webhook escriba datos
 * reales. Eso es un préstamo, y la forma de que salga barato es que el seed sea
 * **deliberadamente incómodo**: si solo produce hilos cortos y prolijos, la
 * pantalla se ve hermosa y después se rompe con el primer nombre de cuarenta
 * caracteres.
 *
 * Dos familias de tests, y las dos importan:
 *
 * 1. Que **cubra los filtros de la bandeja**. Sin eso construyo la UI sin ver
 *    nunca una cola vacía, una conversación pausada ni un hilo de sesenta
 *    mensajes.
 * 2. Que cada hilo **diga algo**. Antes cada frase era un sorteo independiente
 *    de un pool plano, así que el deudor decía "yo no soy, ese número está
 *    equivocado" y el agente contestaba con el plan de cuotas. Eso no es un
 *    dato feo: es un dato imposible, y construir contra datos imposibles
 *    esconde justo los estados que la pantalla tiene que saber dibujar.
 */

const OBLIGACIONES = Array.from({ length: 30 }, (_, i) => ({
  id: `obl-${i}`,
  deudorId: `deu-${i}`,
  deudorNombre: i === 3 ? 'María Fernanda Restrepo Villalobos de la Cruz' : `Deudor ${i}`,
  numeroCredito: `CR-${1000 + i}`,
  saldoTotal: 250_000 + i * 137_000,
  diasMora: i * 7 - 10,
}))
const USUARIOS = ['user-a', 'user-b', 'user-c']
const AHORA = '2026-08-20T15:00:00-05:00'
const EMPRESA = 'Ferretería El Tornillo S.A.S.'

const generar = () =>
  generarHilos({
    obligaciones: OBLIGACIONES,
    usuarios: USUARIOS,
    empresa: EMPRESA,
    ahora: AHORA,
    semilla: 7,
  })

describe('generarHilos', () => {
  it('es determinista: la misma semilla da la misma bandeja', () => {
    expect(JSON.stringify(generar())).toBe(JSON.stringify(generar()))
  })

  it('cubre los cuatro filtros de la bandeja', () => {
    const hilos = generar()

    // Si alguno de estos da cero, hay una pantalla que nunca voy a ver mientras
    // construyo, y que el cliente sí va a ver el primer día.
    expect(hilos.filter((h) => h.asignadaA === null).length).toBeGreaterThan(0)
    expect(hilos.filter((h) => h.asignadaA !== null).length).toBeGreaterThan(0)
    expect(hilos.filter((h) => h.agentePausado).length).toBeGreaterThan(0)
    expect(hilos.filter((h) => h.sinLeerPara.length > 0).length).toBeGreaterThan(0)
  })

  it('produce hilos incómodos, no solo prolijos', () => {
    const hilos = generar()
    const largos = hilos.map((h) => h.mensajes.length)

    // Un hilo de dos mensajes y uno de cuarenta se ven distinto en la lista y
    // en el scroll. Los dos tienen que existir antes de diseñar.
    expect(Math.min(...largos)).toBeLessThanOrEqual(2)
    expect(Math.max(...largos)).toBeGreaterThanOrEqual(20)
  })

  it('incluye intentos bloqueados por ley, que son parte del hilo', () => {
    const bloqueados = generar().flatMap((h) => h.mensajes.filter((m) => m.resultado === 'bloqueado'))

    expect(bloqueados.length).toBeGreaterThan(0)
    expect(bloqueados.every((m) => m.motivoBloqueo !== null)).toBe(true)
  })

  it('deja notas internas y etiquetas en algunos hilos, no en todos', () => {
    const hilos = generar()

    expect(hilos.some((h) => h.notas.length > 0)).toBe(true)
    expect(hilos.some((h) => h.notas.length === 0)).toBe(true)
    expect(hilos.some((h) => h.etiquetas.length > 0)).toBe(true)
  })

  it('ordena los mensajes de cada hilo cronológicamente, sin empates', () => {
    for (const hilo of generar()) {
      // Acá sí vale comparar cadenas: todas salen de toISOString(), o sea el
      // mismo formato UTC, donde el orden lexicográfico es el cronológico.
      const tiempos = hilo.mensajes.map((m) => m.ocurridoEn)
      expect([...tiempos].sort()).toEqual(tiempos)

      // Estrictamente creciente. Dos mensajes con el mismo instante dejan el
      // orden del hilo a merced de la estabilidad del sort, y el hilo deja de
      // ser reproducible aunque la semilla no cambie.
      expect(new Set(tiempos).size).toBe(tiempos.length)
    }
  })

  it('el último mensaje de un hilo nunca es posterior a ahora', () => {
    // Se comparan instantes, no cadenas: `AHORA` viene con offset -05:00 y lo
    // generado es UTC con Z. Lexicográficamente esas dos cadenas no se pueden
    // comparar, aunque las dos sean ISO válidas.
    const limite = new Date(AHORA).getTime()

    for (const hilo of generar()) {
      const ultimo = hilo.mensajes.at(-1)
      if (ultimo) expect(new Date(ultimo.ocurridoEn).getTime()).toBeLessThanOrEqual(limite)
    }
  })

  it('solo asigna a usuarios que existen', () => {
    const asignados = generar().map((h) => h.asignadaA).filter((u): u is string => u !== null)

    expect(asignados.every((u) => USUARIOS.includes(u))).toBe(true)
  })

  // --- Coherencia del hilo ---

  it('el deudor nunca escribe dos veces seguidas sin respuesta en el medio', () => {
    // El agente sí puede insistir varias veces seguidas: eso es la cadencia, y
    // es la mitad de los hilos reales. Lo que no pasa nunca es que el deudor se
    // conteste a sí mismo.
    for (const hilo of generar()) {
      const seguidos = hilo.mensajes.filter(
        (m, i) => i > 0 && m.direccion === 'entrante' && hilo.mensajes[i - 1].direccion === 'entrante',
      )
      expect(seguidos).toEqual([])
    }
  })

  it('ningún mensaje entregado va vacío', () => {
    // Un cuerpo vacío solo tiene sentido en un intento que la ley bloqueó: no
    // llegó a redactarse. En cualquier otro caso es un mensaje fantasma que en
    // pantalla se ve idéntico a un bloqueado.
    for (const hilo of generar()) {
      for (const m of hilo.mensajes) {
        if (m.resultado !== 'bloqueado') expect(m.cuerpo.trim()).not.toBe('')
      }
    }
  })

  it('usa el nombre, el crédito y el saldo reales del deudor', () => {
    const hilos = generar()
    const cuerpos = hilos.flatMap((h) => h.mensajes.map((m) => m.cuerpo)).join('\n')

    // El pool viejo tenía "$1.245.000" y "Ferretería El Tornillo" escritos a
    // mano en la frase, así que los treinta hilos hablaban del mismo saldo.
    expect(cuerpos).not.toContain('$1.245.000')
    expect(cuerpos).toContain('CR-1000')
    expect(cuerpos).toContain(EMPRESA)
  })

  it('un hilo que cierra no sigue después del cierre', () => {
    // El bug que se veía en pantalla: el deudor decía "yo no soy, ese número
    // está equivocado", el agente se disculpaba, y el hilo seguía tres mensajes
    // más negociando cuotas con alguien que ya dijo que no es.
    const cerrados = generar().filter((h) => h.marca !== null)
    expect(cerrados.length).toBeGreaterThan(0)

    for (const hilo of cerrados) {
      const guion = GUIONES.find((g) => g.id === hilo.guion)
      expect(guion?.cierra).toBe(true)
      // El último turno del guion es el último mensaje del hilo.
      expect(hilo.mensajes.at(-1)?.direccion).toBe('saliente')
    }
  })

  it('la etiqueta describe lo que realmente pasó en el hilo', () => {
    for (const hilo of generar()) {
      if (!hilo.etiquetas.includes('número errado')) continue
      const dijo = hilo.mensajes.some((m) => m.direccion === 'entrante' && /no soy|equivocad/i.test(m.cuerpo))
      expect(dijo).toBe(true)
    }
  })

  it('marca los hilos donde el deudor pidió la baja o dijo que no es su número', () => {
    const hilos = generar()

    // Sin la marca, `sembrarHilos` no puede revocar el consentimiento y queda
    // un deudor que pidió la baja y sigue contactable.
    expect(hilos.some((h) => h.marca === 'opt-out')).toBe(true)
    expect(hilos.some((h) => h.marca === 'numero-errado')).toBe(true)

    // Al número errado lo toma un humano, así que el hilo queda pausado.
    // El opt-out **no** se pausa: al agente no lo calla un asesor, lo calla el
    // guard. Mezclar las dos cosas borra la diferencia entre una decisión
    // operativa y una prohibición legal, que es justo lo que la compuerta
    // separa en dos ramas.
    expect(hilos.every((h) => h.marca !== 'numero-errado' || h.agentePausado)).toBe(true)
    expect(hilos.every((h) => h.marca !== 'opt-out' || !h.agentePausado)).toBe(true)
  })

  it('todo hilo empieza con la presentación de la empresa', () => {
    // Cuando la apertura era el primer turno de cada arco y el preludio de
    // cadencia se anteponía, la presentación caía en el mensaje veinte, con el
    // deudor ya respondiendo. Un hilo de cobranza empieza porque la empresa
    // escribe.
    for (const hilo of generar()) {
      const primero = hilo.mensajes[0]
      expect(primero.direccion).toBe('saliente')
      expect(primero.cuerpo).toContain(EMPRESA)
    }
  })

  it('lo que contesta el agente responde a lo que preguntó el deudor', () => {
    // La pregunta por el saldo se contesta con el saldo. Cuando las frases del
    // deudor y las del agente se sorteaban por separado, salía "cuánto es lo que
    // debo exactamente" seguido de "sin problema, quedo atento".
    for (const hilo of generar()) {
      hilo.mensajes.forEach((m, i) => {
        if (!/cuánto es lo que debo/.test(m.cuerpo)) return
        const respuesta = hilo.mensajes[i + 1]
        if (!respuesta || respuesta.resultado === 'bloqueado') return
        expect(respuesta.cuerpo).toMatch(/saldo/i)
      })
    }
  })

  it('el motivo del bloqueo no lo desmiente la fecha', () => {
    // El hilo es la evidencia que se le muestra a la SIC. Un `festivo` un martes
    // cualquiera, o un `domingo` un jueves, convierte la prueba en un problema.
    for (const hilo of generar()) {
      for (const m of hilo.mensajes) {
        if (m.motivoBloqueo === null) continue
        const t = enBogota(new Date(m.ocurridoEn))
        if (m.motivoBloqueo === 'domingo') expect(t.diaSemana).toBe(0)
        if (m.motivoBloqueo === 'festivo') expect(esFestivo(t.fecha)).toBe(true)
        if (m.motivoBloqueo === 'fuera_de_ventana_legal' || m.motivoBloqueo === 'limite_semanal') {
          expect(t.diaSemana).not.toBe(0)
          expect(esFestivo(t.fecha)).toBe(false)
        }
      }
    }
  })

  it('el agente nunca escribe cuando la Ley 2300 no lo permite', () => {
    // La ventana va escrita a mano y no importada del seed a propósito: si
    // alguien afloja la constante del generador, este test sigue sosteniendo la
    // ley. Domingos y festivos, prohibido; L-V 7 a 19; sábado 8 a 15.
    const VENTANA: Array<[number, number] | null> = [
      null,
      [7, 19],
      [7, 19],
      [7, 19],
      [7, 19],
      [7, 19],
      [8, 15],
    ]

    for (const hilo of generar()) {
      for (const m of hilo.mensajes) {
        if (m.direccion !== 'saliente') continue
        const t = enBogota(new Date(m.ocurridoEn))
        const v = VENTANA[t.diaSemana]
        const dentro =
          v !== null && !esFestivo(t.fecha) && t.hora >= v[0] && t.hora < v[1]

        // Un envío entregado un domingo no es un dato feo: es la confesión de
        // la infracción que el producto se vende por evitar. Y un intento
        // bloqueado en horario hábil es un motivo que la fecha desmiente.
        expect(dentro).toBe(m.resultado !== 'bloqueado')
      }
    }
  })

  it('la nota interna no queda fechada después del hilo que comenta', () => {
    for (const hilo of generar()) {
      const ultimo = hilo.mensajes.at(-1)
      for (const nota of hilo.notas) {
        expect(new Date(nota.ocurridoEn).getTime()).toBeLessThanOrEqual(
          new Date(ultimo!.ocurridoEn).getTime(),
        )
      }
    }
  })

  it('usa todos los guiones del catálogo', () => {
    // Un guion que nunca sale es una pantalla que nunca veo.
    const usados = new Set(generar().map((h) => h.guion))
    expect(usados.size).toBe(GUIONES.length)
  })
})
