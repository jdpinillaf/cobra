import { listarObligaciones } from '@/repo/cobranza/cartera'
import { TENANT_DEV, obtenerDb } from '@/repo/conexion'
import { Celda, Encabezado, Estado, Tabla } from '@/components/consola/Tabla'

export const dynamic = 'force-dynamic'

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

/**
 * El tramo no es decoración: es lo que decide qué cadencia corre y con qué
 * tono habla el agente. Ordenado de menos a más grave para que la lectura de
 * izquierda a derecha coincida con la gravedad.
 */
const TRAMOS = ['preventiva', 'temprana', 'media', 'tardia', 'castigada'] as const

const COLUMNAS = [
  { clave: 'deudor', label: 'Deudor' },
  { clave: 'credito', label: 'Crédito' },
  { clave: 'tramo', label: 'Tramo' },
  { clave: 'mora', label: 'Días mora', num: true },
  { clave: 'saldo', label: 'Saldo', num: true },
  { clave: 'estado', label: 'Estado' },
]

export default async function PaginaCartera() {
  const db = await obtenerDb()
  const obligaciones = await listarObligaciones(db, TENANT_DEV)

  const saldoTotal = obligaciones.reduce((s, o) => s + o.saldoTotal, 0)
  const sinContactar = obligaciones.filter((o) => !o.contactable).length
  const porTramo = Object.fromEntries(
    TRAMOS.map((t) => [t, obligaciones.filter((o) => o.tramo === t).length]),
  )

  if (obligaciones.length === 0) {
    return (
      <div className="max-w-prose">
        <h1 className="font-serif text-title">Cartera</h1>
        <p className="mt-4 text-ink-soft">
          No hay cartera cargada todavía. Corré <code className="text-ink">pnpm sembrar</code> para
          generar 40 deudores de prueba, o conectá una fuente real desde Cargas.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="font-serif text-title">Cartera</h1>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Obligaciones</dt>
          <dd className="mt-1 text-lead tabular-nums">{obligaciones.length}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Saldo total</dt>
          <dd className="mt-1 text-lead tabular-nums">{cop(saldoTotal)}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Sin contactar</dt>
          <dd className="mt-1 text-lead tabular-nums">
            {sinContactar > 0 ? <span className="text-bloqueado">{sinContactar}</span> : 0}
          </dd>
        </div>
        {TRAMOS.filter((t) => porTramo[t] > 0).map((t) => (
          <div key={t}>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">{t}</dt>
            <dd className="mt-1 text-lead tabular-nums">{porTramo[t]}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-sm text-ink-faint">
        Sin contactar son deudores sin consentimiento o que pidieron la baja. El motor de
        cumplimiento los bloquea por su cuenta; acá se muestran para que se vea cuántos son.
      </p>

      <div className="mt-6">
        <Tabla>
          <Encabezado columnas={COLUMNAS} />
          <tbody>
            {obligaciones.map((o) => (
              <tr key={o.id} className="border-b border-rule">
                <Celda>
                  {o.deudorNombre}
                  <span className="block text-ink-faint">{o.telefono ?? 'sin teléfono'}</span>
                </Celda>
                <Celda suave>{o.numeroCredito}</Celda>
                <Celda suave>{o.tramo}</Celda>
                <Celda num>{o.diasMora}</Celda>
                <Celda num>{cop(o.saldoTotal)}</Celda>
                <Celda>
                  {!o.contactable ? (
                    <Estado tono="bloqueado">no contactable</Estado>
                  ) : o.estado === 'al_dia' || o.estado === 'pagada' ? (
                    <Estado tono="entregado">{o.estado.replace('_', ' ')}</Estado>
                  ) : o.estado === 'en_mora' ? (
                    <Estado tono="diferido">en mora</Estado>
                  ) : (
                    <Estado tono="neutro">{o.estado.replace('_', ' ')}</Estado>
                  )}
                </Celda>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </div>
    </div>
  )
}
