'use client'

import { useRef, useState } from 'react'
import type { RespuestaCruce } from '@/app/api/conciliacion/cargar/route'
import type { Descuadre, FilaCruzada } from '@/conciliacion/cruce'
import { Celda, Encabezado, Estado, Tabla } from '@/components/consola/Tabla'
import { cop, numero } from '@/lib/formato'

const pesos = (centavos: number): string => cop(Math.round(centavos / 100))

const ETIQUETA: Record<Descuadre, { texto: string; tono: 'entregado' | 'diferido' | 'bloqueado' | 'neutro' }> = {
  cuadra: { texto: 'Cuadra', tono: 'entregado' },
  falta_en_contable: { texto: 'No está en el contable', tono: 'bloqueado' },
  falta_en_excel: { texto: 'No está en el Excel', tono: 'bloqueado' },
  monto_distinto: { texto: 'Monto distinto', tono: 'diferido' },
  duplicado: { texto: 'Repetida', tono: 'diferido' },
}

const COLUMNAS = [
  { clave: 'ref', label: 'Referencia' },
  { clave: 'estado', label: 'Qué pasa' },
  { clave: 'contable', label: 'Contable', num: true },
  { clave: 'excel', label: 'Excel', num: true },
  { clave: 'dif', label: 'Diferencia', num: true },
]

export function Cruce() {
  const contable = useRef<HTMLInputElement>(null)
  const excel = useRef<HTMLInputElement>(null)
  const [r, setR] = useState<RespuestaCruce | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [soloDescuadres, setSoloDescuadres] = useState(true)

  async function cruzar(columnas?: { clave: string; monto: string }) {
    const a = contable.current?.files?.[0]
    const b = excel.current?.files?.[0]
    if (!a || !b) {
      setError('Elija los dos archivos.')
      return
    }

    setCargando(true)
    setError(null)
    try {
      const datos = new FormData()
      datos.append('contable', a)
      datos.append('excel', b)
      if (columnas) {
        datos.append('clave', columnas.clave)
        datos.append('monto', columnas.monto)
      }
      const res = await fetch('/api/conciliacion/cargar', { method: 'POST', body: datos })
      const cuerpo = (await res.json()) as RespuestaCruce & { error?: string }
      if (!res.ok) {
        setError(cuerpo.error ?? 'No se pudo cruzar.')
        setR(null)
        return
      }
      setR(cuerpo)
      setError(cuerpo.error ?? null)
    } catch {
      setError('No se pudo cruzar. Revise los archivos.')
    } finally {
      setCargando(false)
    }
  }

  const filas = r?.cruce?.filas ?? []
  const visibles = soloDescuadres ? filas.filter((f) => f.descuadre !== 'cuadra') : filas

  return (
    <div>
      <section className="mt-6">
        <p className="marca-seccion">§01 · Los dos archivos</p>
        <div className="mt-3 flex flex-wrap gap-8">
          <Archivo id="archivo-contable" etiqueta="Export del software contable" refInput={contable} />
          <Archivo id="archivo-excel" etiqueta="El Excel de la operación" refInput={excel} />
        </div>
        <button
          type="button"
          onClick={() => void cruzar()}
          disabled={cargando}
          className="mt-5 border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
        >
          {cargando ? 'Cruzando…' : 'Cruzar'}
        </button>
        <p className="mt-3 max-w-prose text-sm text-ink-faint">
          Acepta <code>.xlsx</code> y <code>.csv</code>. Los archivos se leen y se descartan: no
          se guarda copia de su cartera en ningún lado.
        </p>
      </section>

      {error && (
        <p role="alert" className="mt-5 text-sm text-bloqueado">
          {error}
        </p>
      )}

      {r && !r.cruce && (
        <Selector respuesta={r} onElegir={(c) => void cruzar(c)} />
      )}

      {r?.cruce && (
        <>
          <section className="mt-10">
            <p className="marca-seccion">§02 · Cuánta plata está en juego</p>
            <p className="mt-3 font-serif text-display tabular-nums">
              {pesos(r.cruce.valorEnRiesgoCentavos)}
            </p>
            <p className="mt-1 max-w-prose text-ink-soft">
              es lo que está en un archivo y no en el otro, o lo que difiere entre los dos.
              Cruzamos {numero(r.filas.contable)} registros del contable contra{' '}
              {numero(r.filas.excel)} del Excel por{' '}
              <span className="text-ink">{r.columnas.clave}</span>.
            </p>

            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
              <Metrica etiqueta="Cuadran" valor={numero(r.cruce.resumen.cuadra)} />
              <Metrica etiqueta="No están en el contable" valor={numero(r.cruce.resumen.falta_en_contable)} />
              <Metrica etiqueta="No están en el Excel" valor={numero(r.cruce.resumen.falta_en_excel)} />
              <Metrica etiqueta="Monto distinto" valor={numero(r.cruce.resumen.monto_distinto)} />
              <Metrica etiqueta="Repetidas" valor={numero(r.cruce.resumen.duplicado)} />
            </dl>

            <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
              <Metrica etiqueta="Total contable" valor={pesos(r.cruce.totalContableCentavos)} />
              <Metrica etiqueta="Total Excel" valor={pesos(r.cruce.totalExcelCentavos)} />
            </dl>
          </section>

          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-4">
              <p className="marca-seccion">§03 · Fila por fila</p>
              <button
                type="button"
                onClick={() => setSoloDescuadres((v) => !v)}
                className="text-sm text-ink-soft underline underline-offset-4"
              >
                {soloDescuadres ? 'Ver también las que cuadran' : 'Ver solo los descuadres'}
              </button>
            </div>
            <div className="mt-3">
              <Tabla>
                <Encabezado columnas={COLUMNAS} />
                <tbody>
                  {visibles.slice(0, 500).map((f) => (
                    <Fila key={f.clave} fila={f} />
                  ))}
                </tbody>
              </Tabla>
            </div>
            {visibles.length > 500 && (
              <p className="mt-3 text-sm text-ink-faint">
                Se muestran las primeras 500 de {numero(visibles.length)}.
              </p>
            )}
          </section>

          {r.cruce.ilegibles.length > 0 && (
            <section className="mt-10">
              <p className="marca-seccion">§04 · Filas que no se pudieron leer</p>
              <p className="mt-3 max-w-prose text-ink-soft">
                {numero(r.cruce.ilegibles.length)}{' '}
                {r.cruce.ilegibles.length === 1 ? 'fila quedó' : 'filas quedaron'} fuera del cruce.
                No tumban el resultado, pero hay que mirarlas: lo que no se pudo leer tampoco se
                pudo verificar.
              </p>
              <ul className="mt-3 max-w-prose">
                {r.cruce.ilegibles.slice(0, 20).map((i, n) => (
                  <li key={n} className="border-b border-rule py-2 text-sm">
                    <span className="text-ink-faint">
                      {i.origen === 'contable' ? 'Contable' : 'Excel'}, fila {i.numeroFila}:
                    </span>{' '}
                    <span className="text-ink">{i.motivo}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Fila({ fila }: { fila: FilaCruzada }) {
  const e = ETIQUETA[fila.descuadre]
  return (
    <tr className="border-b border-rule hover:bg-paper-deep">
      <Celda>{fila.claveOriginal}</Celda>
      <Celda>
        <Estado tono={e.tono}>{e.texto}</Estado>
        {(fila.vecesEnContable > 1 || fila.vecesEnExcel > 1) && (
          <span className="ml-2 text-ink-faint">
            ({fila.vecesEnContable}/{fila.vecesEnExcel} filas)
          </span>
        )}
      </Celda>
      <Celda num suave>{fila.contableCentavos === null ? '—' : pesos(fila.contableCentavos)}</Celda>
      <Celda num suave>{fila.excelCentavos === null ? '—' : pesos(fila.excelCentavos)}</Celda>
      <Celda num>{fila.diferenciaCentavos === 0 ? '—' : pesos(fila.diferenciaCentavos)}</Celda>
    </tr>
  )
}

function Archivo({
  id,
  etiqueta,
  refInput,
}: {
  id: string
  etiqueta: string
  refInput: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">{etiqueta}</span>
      <input
        id={id}
        ref={refInput}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv,.txt"
        className="mt-1.5 block w-full max-w-xs text-sm text-ink-soft file:mr-3 file:border file:border-rule-strong file:bg-paper file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-paper-deep"
      />
    </label>
  )
}

function Selector({
  respuesta,
  onElegir,
}: {
  respuesta: RespuestaCruce
  onElegir: (c: { clave: string; monto: string }) => void
}) {
  const comunes = respuesta.encabezados.contable.filter((e) =>
    respuesta.encabezados.excel.includes(e),
  )
  const [clave, setClave] = useState(respuesta.columnas.clave ?? comunes[0] ?? '')
  const [monto, setMonto] = useState(respuesta.columnas.monto ?? comunes[1] ?? '')

  return (
    <section className="mt-8">
      <p className="marca-seccion">§02 · Por cuáles columnas cruzo</p>
      <div className="mt-3 flex flex-wrap gap-6">
        <Campo etiqueta="Referencia" valor={clave} onCambio={setClave} opciones={comunes} />
        <Campo etiqueta="Valor" valor={monto} onCambio={setMonto} opciones={comunes} />
      </div>
      <button
        type="button"
        disabled={!clave || !monto || clave === monto}
        onClick={() => onElegir({ clave, monto })}
        className="mt-5 border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
      >
        Cruzar por estas
      </button>
      {comunes.length === 0 && (
        <p className="mt-3 max-w-prose text-sm text-bloqueado">
          Los dos archivos no comparten ninguna columna con el mismo nombre. Renombre la columna
          de referencia para que coincida en los dos.
        </p>
      )}
    </section>
  )
}

function Campo({
  etiqueta,
  valor,
  onCambio,
  opciones,
}: {
  etiqueta: string
  valor: string
  onCambio: (v: string) => void
  opciones: string[]
}) {
  return (
    <label className="block">
      <span className="text-marca uppercase tracking-[0.14em] text-ink-faint">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="mt-1.5 block w-56 border border-rule-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
      >
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">{etiqueta}</dt>
      <dd className="mt-1 text-lead tabular-nums">{valor}</dd>
    </div>
  )
}
