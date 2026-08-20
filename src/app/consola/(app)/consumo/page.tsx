import Link from 'next/link'
import { requerirSesion } from '@/auth/actual'
import { Celda, Encabezado, Estado, Tabla } from '@/components/consola/Tabla'
import { cop, numero, pct } from '@/lib/formato'
import {
  bordesDelMes,
  consumoIaDelPeriodo,
  cupoDelCliente,
  mesesRecientes,
  resumenDelPeriodo,
} from '@/repo/cobranza/consumo'
import { obtenerDb } from '@/repo/conexion'

export const dynamic = 'force-dynamic'

/**
 * Consumo.
 *
 * La pantalla existe para responder tres preguntas que hasta ahora no tenían de
 * dónde salir, y para **no mezclarlas**:
 *
 *   1. ¿Cuánto le pagamos a Meta? — `SUM(costo_cop)`. Es un egreso.
 *   2. ¿Cuánto del cupo vendido se consumió? — es margen, no costo. Con Meta
 *      directo el tráfico conversacional es gratis, así que bajar el cupo no
 *      evita un gasto: cede margen.
 *   3. ¿Cuánto cuesta pensar? — tokens, medidos por conversación, que es la
 *      unidad que se factura.
 *
 * Los tres van separados en la pantalla porque juntarlos en un solo número es
 * exactamente cómo se negocia mal un contrato.
 */

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const TONO_CATEGORIA: Record<string, 'entregado' | 'diferido' | 'bloqueado' | 'neutro'> = {
  servicio: 'entregado',
  utility: 'neutro',
  authentication: 'neutro',
  marketing: 'bloqueado',
}

export default async function PaginaConsumo({
  searchParams,
}: {
  searchParams?: Promise<{ mes?: string }>
}) {
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  const opciones = mesesRecientes(new Date())
  // Lista blanca: el mes viene de la URL y sin esto entraría crudo a la consulta
  // como rango de fechas.
  const parametros = (await searchParams) ?? {}
  const mes = opciones.includes(parametros.mes ?? '') ? parametros.mes! : opciones[0]
  const periodo = bordesDelMes(mes)

  const [resumen, ia, cupo] = await Promise.all([
    resumenDelPeriodo(db, sesion.tenantId, periodo),
    consumoIaDelPeriodo(db, sesion.tenantId, periodo),
    cupoDelCliente(db, sesion.tenantId),
  ])

  const [anio, m] = mes.split('-').map(Number)
  const etiquetaMes = `${MESES[m - 1]} de ${anio}`

  const usoConversaciones = cupo ? resumen.conversaciones / cupo.conversacionesMes : null
  const plantillas = resumen.porCategoria
    .filter((c) => c.categoria !== 'servicio')
    .reduce((s, c) => s + c.mensajes, 0)
  const usoPlantillas = cupo ? plantillas / cupo.plantillasMes : null

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="font-serif text-title">Consumo</h1>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {opciones.map((o) => {
            const [a, n] = o.split('-').map(Number)
            return (
              <Link
                key={o}
                href={`/consola/consumo?mes=${o}`}
                className={
                  o === mes
                    ? 'text-ink underline underline-offset-4'
                    : 'text-ink-faint hover:text-ink-soft'
                }
              >
                {MESES[n - 1].slice(0, 3)} {String(a).slice(2)}
              </Link>
            )
          })}
        </nav>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Costo del canal</dt>
          <dd className="mt-1 text-lead tabular-nums">{cop(Math.round(resumen.costoCop))}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Conversaciones</dt>
          <dd className="mt-1 text-lead tabular-nums">{numero(resumen.conversaciones)}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Mensajes</dt>
          <dd className="mt-1 text-lead tabular-nums">{numero(resumen.mensajesQueCuentan)}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">
            Bloqueados por ley
          </dt>
          <dd className="mt-1 text-lead tabular-nums">{numero(resumen.bloqueados)}</dd>
        </div>
        <div>
          <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Turnos de IA</dt>
          <dd className="mt-1 text-lead tabular-nums">{numero(ia.turnos)}</dd>
        </div>
      </dl>

      <p className="mt-4 max-w-prose text-sm text-ink-faint">
        El costo del canal es lo que se le paga a Meta y a Twilio. No incluye lo que se manda
        desde el modo demo, que no se le cobra a nadie. Los bloqueados no cuestan ni consumen
        cupo: están acá porque son la evidencia de que la Ley 2300 se respetó.
      </p>

      {resumen.mensajesQueCuentan === 0 && resumen.bloqueados === 0 && (
        <p className="mt-8 text-ink-soft">
          No hubo actividad en {etiquetaMes}. Probá otro mes.
        </p>
      )}

      {resumen.porCategoria.length > 0 && (
        <section className="mt-8">
          <p className="marca-seccion">En qué se fue la plata</p>
          <div className="mt-3">
            <Tabla>
              <Encabezado
                columnas={[
                  { clave: 'categoria', label: 'Categoría' },
                  { clave: 'mensajes', label: 'Mensajes', num: true },
                  { clave: 'costo', label: 'Costo', num: true },
                  { clave: 'unitario', label: 'Por mensaje', num: true },
                ]}
              />
              <tbody>
                {resumen.porCategoria.map((c) => (
                  <tr key={c.categoria} className="border-b border-rule">
                    <Celda>
                      <Estado tono={TONO_CATEGORIA[c.categoria] ?? 'neutro'}>{c.categoria}</Estado>
                    </Celda>
                    <Celda num>{numero(c.mensajes)}</Celda>
                    <Celda num>{cop(Math.round(c.costoCop))}</Celda>
                    <Celda num>
                      {c.costoCop === 0
                        ? 'gratis'
                        : `$ ${(c.costoCop / c.mensajes).toFixed(1).replace('.', ',')}`}
                    </Celda>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </div>
          <p className="mt-3 max-w-prose text-sm text-ink-faint">
            <strong className="font-medium text-ink-soft">servicio</strong> es el texto libre
            dentro de las 24 horas que abre el deudor al escribir. Meta no lo cobra, sin tope. Es
            el motivo de haber ido a Meta directo en vez de por un revendedor, y por eso conviene
            que la conversación siga viva.
          </p>
        </section>
      )}

      {cupo && (
        <section className="mt-8">
          <p className="marca-seccion">Contra lo contratado</p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <Cupo
              titulo="Conversaciones"
              usadas={resumen.conversaciones}
              tope={cupo.conversacionesMes}
              uso={usoConversaciones}
              excedenteCop={cupo.excedenteConversacionCop}
              umbral={cupo.umbralAvisoPct}
            />
            <Cupo
              titulo="Plantillas"
              usadas={plantillas}
              tope={cupo.plantillasMes}
              uso={usoPlantillas}
              excedenteCop={cupo.excedentePlantillaCop}
              umbral={cupo.umbralAvisoPct}
            />
          </dl>
          <p className="mt-3 max-w-prose text-sm text-ink-faint">
            El cupo es margen, no costo. Con Meta directo el tráfico conversacional es gratis, así
            que rebajar el cupo en una negociación no evita un gasto: cede margen.
          </p>
        </section>
      )}

      <section className="mt-8">
        <p className="marca-seccion">Lo que cuesta pensar</p>
        <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-4 border-y border-rule py-4">
          <div>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">
              Turnos por conversación
            </dt>
            <dd className="mt-1 text-lead tabular-nums">
              {ia.conversaciones > 0 ? (ia.turnos / ia.conversaciones).toFixed(1).replace('.', ',') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Tokens de entrada</dt>
            <dd className="mt-1 text-lead tabular-nums">{numero(ia.tokensEntrada)}</dd>
          </div>
          <div>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">Tokens de salida</dt>
            <dd className="mt-1 text-lead tabular-nums">{numero(ia.tokensSalida)}</dd>
          </div>
          <div>
            <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">
              Latencia mediana
            </dt>
            <dd className="mt-1 text-lead tabular-nums">
              {ia.latenciaMedianaMs === null
                ? '—'
                : `${(ia.latenciaMedianaMs / 1000).toFixed(1).replace('.', ',')} s`}
            </dd>
          </div>
        </dl>
        <p className="mt-3 max-w-prose text-sm text-ink-faint">
          {ia.turnos === 0
            ? 'El agente no contestó ninguna conversación este mes, así que no hay consumo de IA que medir.'
            : 'Al cliente se le cobra por conversación y a nosotros nos cuesta por turno. Los turnos por conversación son la brecha entre las dos cosas, y es lo que hay que bajar.'}
        </p>
      </section>
    </div>
  )
}

/**
 * Un cubo de cupo.
 *
 * Muestra el excedente proyectado solo cuando ya se pasó. Antes de pasarse el
 * número es cero y ocupar una línea para decir "cero" convierte una alerta en
 * ruido de fondo.
 */
function Cupo({
  titulo,
  usadas,
  tope,
  uso,
  excedenteCop,
  umbral,
}: {
  titulo: string
  usadas: number
  tope: number
  uso: number | null
  excedenteCop: number
  umbral: number
}) {
  const excedidas = Math.max(0, usadas - tope)
  const alerta = uso !== null && uso * 100 >= umbral

  return (
    <div className="border border-rule p-4">
      <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">{titulo}</dt>
      <dd className="mt-1">
        <span className={`text-lead tabular-nums ${alerta ? 'text-bloqueado' : ''}`}>
          {numero(usadas)}
        </span>
        <span className="text-ink-faint"> de {numero(tope)}</span>
        {uso !== null && (
          <span className="ml-2 text-sm text-ink-faint tabular-nums">{pct(uso, 0)}</span>
        )}
      </dd>
      {excedidas > 0 && (
        <p className="mt-2 text-sm text-bloqueado">
          {numero(excedidas)} por encima · {cop(excedidas * excedenteCop)} de excedente
        </p>
      )}
    </div>
  )
}
