import { describe, expect, it } from 'vitest'
import { generarHilos } from './seed-hilos'

/**
 * El seed de conversaciones.
 *
 * Existe para poder construir la bandeja antes de que el webhook escriba datos
 * reales. Eso es un préstamo, y la forma de que salga barato es que el seed sea
 * **deliberadamente incómodo**: si solo produce hilos cortos y prolijos, la
 * pantalla se ve hermosa y después se rompe con el primer nombre de cuarenta
 * caracteres.
 *
 * El test que más importa no es que genere 30 hilos: es que **cubra todos los
 * filtros de la bandeja**. Sin eso construyo la UI sin ver nunca una cola vacía,
 * una conversación pausada ni un hilo de sesenta mensajes.
 */

const OBLIGACIONES = Array.from({ length: 30 }, (_, i) => ({
  id: `obl-${i}`,
  deudorId: `deu-${i}`,
  deudorNombre: i === 3 ? 'María Fernanda Restrepo Villalobos de la Cruz' : `Deudor ${i}`,
  diasMora: i * 7 - 10,
}))
const USUARIOS = ['user-a', 'user-b', 'user-c']
const AHORA = '2026-08-20T15:00:00-05:00'

const generar = () => generarHilos({ obligaciones: OBLIGACIONES, usuarios: USUARIOS, ahora: AHORA, semilla: 7 })

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

  it('no pone dos mensajes seguidos del mismo lado', () => {
    // El generador arma los turnos alternando deudor y agente. Cuando los
    // instantes se calculaban con un salto aleatorio **por mensaje**, los
    // offsets no quedaban ordenados y el `sort` posterior desarmaba justo esa
    // alternancia: salían dos frases del agente pegadas, o el deudor
    // respondiéndose a sí mismo. Era el 38 % de los pares.
    //
    // El síntoma que se veía en pantalla era peor que un problema de orden: la
    // disculpa por el número equivocado quedaba seguida del plan de cuotas.
    for (const hilo of generar()) {
      const seguidos = hilo.mensajes.filter(
        (m, i) => i > 0 && m.direccion === hilo.mensajes[i - 1].direccion,
      )
      expect(seguidos).toEqual([])
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
})
