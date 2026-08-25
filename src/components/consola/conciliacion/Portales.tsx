'use client'

import { useRef, useState } from 'react'
import type { RespuestaPortales } from '@/app/api/conciliacion/portales/route'
import type { FilaMultiple } from '@/conciliacion/cruce'
import { Celda, Encabezado, Estado, Tabla } from '@/components/consola/Tabla'
import { cop, numero } from '@/lib/formato'

const pesos = (centavos: number | null): string => (centavos === null ? '—' : cop(Math.round(centavos / 100)))

const GRAVEDAD = {
  alta: 'bloqueado',
  media: 'diferido',
  baja: 'neutro',
} as const

export function Portales() {
  const excel = useRef<HTMLInputElement>(null)
  const [r, setR] = useState<RespuestaPortales | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [todas, setTodas] = useState(false)

  async function conciliar() {
    setCargando(true)
    setError(null)
    try {
      const datos = new FormData()
      const archivo = excel.current?.files?.[0]
      if (archivo) datos.append('excel', archivo)

      const res = await fetch('/api/conciliacion/portales', { method: 'POST', body: datos })
      const cuerpo = (await res.json()) as RespuestaPortales
      setR(cuerpo)
      setError(cuerpo.error ?? null)
    } catch {
      setError('No se pudo conciliar. Revise que los portales respondan.')
    } finally {
      setCargando(false)
    }
  }

  const filas = r?.cruce?.filas ?? []
  const visibles = todas ? filas : filas.filter((f) => f.estado !== 'cuadra')
  const claves = r?.cruce?.fuentes.map((f) => f.clave) ?? []

  return (
    <div>
      <section className="mt-6">
        <p className="marca-seccion">§01 · De dónde salen los datos</p>
        <p className="mt-3 max-w-prose text-ink-soft">
          El portal contable y el del banco se consultan por API. El Excel de la operación lo
          sube usted; si no lo sube, se concilian los dos portales entre sí.
        </p>
        <label className="mt-5 block" htmlFor="portales-excel">
          <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">
            Excel de la operación (opcional)
          </span>
          <input
            id="portales-excel"
            ref={excel}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt"
            className="mt-1.5 block w-full max-w-xs text-sm text-ink-soft file:mr-3 file:border file:border-rule-strong file:bg-paper file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-paper-deep"
          />
        </label>
        <button
          type="button"
          onClick={() => void conciliar()}
          disabled={cargando}
          className="mt-5 border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
        >
          {cargando ? 'Conciliando…' : 'Conciliar'}
        </button>
      </section>

      {error && (
        <p role="alert" className="mt-5 text-sm text-bloqueado">
          {error}
        </p>
      )}

      {r && r.fuentes.length > 0 && (
        <section className="mt-8">
          <p className="marca-seccion">§02 · Qué respondió cada fuente</p>
          <div className="mt-3">
            <Tabla>
              <Encabezado
                columnas={[
                  { clave: 'f', label: 'Fuente' },
                  { clave: 't', label: 'Cómo se conecta' },
                  { clave: 'p', label: 'Procedencia' },
                  { clave: 'n', label: 'Filas', num: true },
                ]}
              />
              <tbody>
                {r.fuentes.map((f) => (
                  <tr key={f.clave} className="border-b border-rule">
                    <Celda>{f.nombre}</Celda>
                    <Celda suave>{f.tipo === 'api' ? 'API' : f.tipo === 'archivo' ? 'Archivo' : f.tipo}</Celda>
                    <Celda suave>{f.procedencia}</Celda>
                    <Celda num>{numero(f.filas)}</Celda>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </div>
          {r.fallas.length > 0 && (
            <ul className="mt-3 max-w-prose">
              {r.fallas.map((f, i) => (
                <li key={i} className="py-1 text-sm text-bloqueado">
                  {f.fuente}: {f.motivo}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {r?.veredicto && (
        <section className="mt-10">
          <p className="marca-seccion">§03 · Qué encontró el agente</p>
          <p className="mt-3 font-serif text-display tabular-nums">
            {pesos(r.cruce?.valorEnRiesgoCentavos ?? 0)}
          </p>
          <p className="mt-1 max-w-prose text-ink-soft">{r.veredicto.titular}</p>

          <div className="mt-6 max-w-prose">
            {r.veredicto.hallazgos.map((h, i) => (
              <div key={i} className="border-b border-rule py-4 last:border-0">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-ink">{h.titulo}</p>
                  <Estado tono={GRAVEDAD[h.gravedad]}>{cop(h.montoCop)}</Estado>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{h.explicacion}</p>
                {h.referencias.length > 0 && (
                  <p className="mt-1 text-sm text-ink-faint">{h.referencias.join(' · ')}</p>
                )}
              </div>
            ))}
          </div>

          <p className="mt-5 max-w-prose">
            <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">
              Por dónde empezar
            </span>
            <br />
            <span className="text-ink">{r.veredicto.porDondeEmpezar}</span>
          </p>
          <p className="mt-3 max-w-prose text-sm text-ink-faint">
            El agente explica y prioriza; el cruce lo hace el código, al centavo y sin modelo.
            Ningún hallazgo trae una cifra que no salga de sus archivos.
          </p>
        </section>
      )}

      {r?.cruce && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <p className="marca-seccion">§04 · Fila por fila, fuente por fuente</p>
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              className="text-sm text-ink-soft underline underline-offset-4"
            >
              {todas ? 'Ver solo los descuadres' : 'Ver también las que cuadran'}
            </button>
          </div>
          <div className="mt-3">
            <Tabla>
              <Encabezado
                columnas={[
                  { clave: 'ref', label: 'Referencia' },
                  ...r.cruce.fuentes.map((f) => ({ clave: f.clave, label: f.nombre, num: true })),
                  { clave: 'q', label: 'Qué pasa' },
                ]}
              />
              <tbody>
                {visibles.slice(0, 400).map((f) => (
                  <FilaPortales key={f.clave} fila={f} claves={claves} />
                ))}
              </tbody>
            </Tabla>
          </div>
          {r.cruce.ilegibles.length > 0 && (
            <p className="mt-3 max-w-prose text-sm text-ink-faint">
              {numero(r.cruce.ilegibles.length)} fila(s) quedaron fuera del cruce por venir
              ilegibles: {r.cruce.ilegibles.slice(0, 3).map((i) => `${i.origen} fila ${i.numeroFila}`).join(', ')}.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function FilaPortales({ fila, claves }: { fila: FilaMultiple; claves: string[] }) {
  const tono = fila.estado === 'cuadra' ? 'entregado' : fila.estado === 'monto_distinto' ? 'diferido' : 'bloqueado'
  const texto =
    fila.estado === 'cuadra'
      ? 'Cuadra'
      : fila.estado === 'falta_en_alguna'
        ? `Falta en ${fila.faltaEn.length === claves.length - 1 ? 'las demás' : fila.faltaEn.join(', ')}`
        : 'Montos distintos'

  return (
    <tr className="border-b border-rule hover:bg-paper-deep">
      <Celda>{fila.claveOriginal}</Celda>
      {claves.map((c) => (
        <Celda key={c} num suave={fila.sospechosa !== c}>
          {pesos(fila.porFuente[c] ?? null)}
        </Celda>
      ))}
      <Celda>
        <Estado tono={tono}>{texto}</Estado>
        {fila.sospechosa && (
          /* Con tres fuentes se puede decir cuál se salió, no solo que hay diferencia. */
          <span className="ml-2 text-ink-faint">se desvía {fila.sospechosa}</span>
        )}
      </Celda>
    </tr>
  )
}
