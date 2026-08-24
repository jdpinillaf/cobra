import { describe, expect, it } from 'vitest'
import { FLUJOS, pasoPorId, secuenciaDe } from './flujos'

describe('FLUJOS', () => {
  it('tiene los cuatro agentes, sin ids repetidos', () => {
    expect(FLUJOS).toHaveLength(4)
    expect(new Set(FLUJOS.map((f) => f.id)).size).toBe(4)
  })

  for (const flujo of FLUJOS) {
    describe(flujo.nombre, () => {
      it('no repite ids de paso', () => {
        const ids = flujo.pasos.map((p) => p.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('tiene exactamente un nodo de entrada, y es el primero', () => {
        const entradas = flujo.pasos.filter((p) => p.tipo === 'inicio')
        expect(entradas).toHaveLength(1)
        expect(flujo.pasos[0].tipo).toBe('inicio')
      })

      /** El nodo de entrada es el mensaje que llega: sin rótulo no se entiende de quién. */
      it('rotula la entrada', () => {
        expect(flujo.pasos[0].etiqueta).toBeTruthy()
      })

      it('termina en al menos un cierre', () => {
        expect(flujo.pasos.some((p) => p.tipo === 'fin')).toBe(true)
      })

      it('toda arista apunta a pasos que existen', () => {
        for (const a of flujo.aristas) {
          expect(pasoPorId(flujo, a.de), `origen ${a.de}`).toBeDefined()
          expect(pasoPorId(flujo, a.a), `destino ${a.a}`).toBeDefined()
        }
      })

      /**
       * La secuencia de "siguiente paso" tiene que ser un camino de verdad: si
       * dos pasos consecutivos no están unidos por una arista, el visitante ve
       * saltar el resaltado sin línea que lo explique.
       */
      it('la secuencia principal está unida por aristas, en orden', () => {
        const secuencia = secuenciaDe(flujo)
        expect(secuencia.length).toBeGreaterThanOrEqual(4)

        for (let i = 0; i < secuencia.length - 1; i += 1) {
          const hay = flujo.aristas.some(
            (a) => a.de === secuencia[i].id && a.a === secuencia[i + 1].id,
          )
          expect(hay, `falta arista ${secuencia[i].id} → ${secuencia[i + 1].id}`).toBe(true)
        }
      })

      it('cada rama alterna cuelga de una decisión y está etiquetada', () => {
        for (const paso of flujo.pasos.filter((p) => p.alterna)) {
          const entrantes = flujo.aristas.filter((a) => a.a === paso.id)
          expect(entrantes.length).toBeGreaterThan(0)
          for (const a of entrantes) {
            expect(pasoPorId(flujo, a.de)?.tipo).toBe('decision')
            expect(a.etiqueta).toBeTruthy()
          }
        }
      })

      it('cada decisión tiene una salida por sí y otra por no', () => {
        for (const decision of flujo.pasos.filter((p) => p.tipo === 'decision')) {
          const salidas = flujo.aristas.filter((a) => a.de === decision.id)
          expect(salidas.map((s) => s.etiqueta).sort()).toEqual(['no', 'sí'])
        }
      })

      it('ningún paso queda suelto', () => {
        const tocados = new Set(flujo.aristas.flatMap((a) => [a.de, a.a]))
        for (const paso of flujo.pasos) expect(tocados.has(paso.id), paso.id).toBe(true)
      })

      it('todas las cajas caben en el lienzo', () => {
        for (const p of flujo.pasos) {
          expect(p.x, p.id).toBeGreaterThanOrEqual(0)
          expect(p.y, p.id).toBeGreaterThanOrEqual(0)
          expect(p.x + p.ancho, p.id).toBeLessThanOrEqual(flujo.ancho)
          expect(p.y + p.alto, p.id).toBeLessThanOrEqual(flujo.alto)
        }
      })

      /** Dos líneas es el tope: el SVG no envuelve texto y una tercera se saldría de la caja. */
      it('ningún título pasa de dos líneas cortas', () => {
        for (const p of flujo.pasos) {
          expect(p.titulo.length, p.id).toBeLessThanOrEqual(2)
          for (const linea of p.titulo) expect(linea.length, p.id).toBeLessThanOrEqual(26)
        }
      })

      it('cada paso explica qué hace', () => {
        for (const p of flujo.pasos) expect(p.detalle.length, p.id).toBeGreaterThan(30)
      })

      it('las cajas no se pisan entre sí', () => {
        const pisan = (a: (typeof flujo.pasos)[number], b: typeof a) =>
          a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto

        for (let i = 0; i < flujo.pasos.length; i += 1) {
          for (let j = i + 1; j < flujo.pasos.length; j += 1) {
            expect(
              pisan(flujo.pasos[i], flujo.pasos[j]),
              `${flujo.pasos[i].id} pisa ${flujo.pasos[j].id}`,
            ).toBe(false)
          }
        }
      })
    })
  }
})
