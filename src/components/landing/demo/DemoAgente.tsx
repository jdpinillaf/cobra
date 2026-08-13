'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cop, numero } from '@/lib/formato'
import { VentanaOperacion } from '../VentanaOperacion'
import {
  CADENCIA,
  DURACION_MS,
  GUION,
  HERRAMIENTAS,
  type Tablero,
  faseDe,
  reducir,
} from './guion'
import { FaseConfiguracion } from './FaseConfiguracion'
import { FaseOperacion } from './FaseOperacion'
import { PuntoEstado } from './piezas'
import { useEscritura } from './useEscritura'

/**
 * La demo de la landing: dos actos seguidos, en bucle, sin que nadie toque nada.
 *
 * Primero se configura el agente —instrucción, plan, herramientas—; después se
 * abre la consola y se le ve atender. Mostrar los dos es el punto: sin el
 * primero esto es un chatbot con marco, sin el segundo es un editor de prompts.
 *
 * Una sola cadena de timers sobre un `GUION` plano. La fase se deriva del
 * último evento visible, así que no hay dos máquinas que sincronizar.
 */

const ESPERA_ANTES_DE_REPETIR = 5000

/**
 * Un solo alto para las dos fases: montadas a la vez en la misma celda de
 * grid, el marco no puede saltar en la transición. Se calibra en un sitio.
 */
const ALTO = 'h-[24rem] sm:h-[26rem] lg:h-[28rem]'

export default function DemoAgente() {
  const [indice, setIndice] = useState(0)
  const [vuelta, setVuelta] = useState(0)
  const [activo, setActivo] = useState(false)
  const [pausado, setPausado] = useState(false)
  const [estatico, setEstatico] = useState(false)

  const ancla = useRef<HTMLDivElement | null>(null)
  const hilo = useRef<HTMLDivElement | null>(null)

  /**
   * Con `prefers-reduced-motion` no hay reproducción, pero tampoco basta con
   * saltar al final: la fase 2 taparía la fase 1 y quien pidió menos movimiento
   * vería menos producto. Se muestran las dos, completas y apiladas.
   */
  useEffect(() => {
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    const aplicar = () => {
      setEstatico(consulta.matches)
      if (consulta.matches) setIndice(GUION.length)
    }
    aplicar()
    consulta.addEventListener('change', aplicar)
    return () => consulta.removeEventListener('change', aplicar)
  }, [])

  // Arranca al entrar en pantalla.
  useEffect(() => {
    const nodo = ancla.current
    if (!nodo) return

    const observador = new IntersectionObserver(
      (entradas) => setActivo(entradas[0]?.isIntersecting ?? false),
      { threshold: 0.25 },
    )
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])

  /*
   * En una pestaña de fondo `setTimeout` se estrangula a un segundo o más y el
   * `IntersectionObserver` no se entera: la demo seguiría corriendo a
   * trompicones contra nadie.
   */
  useEffect(() => {
    const alCambiar = () => setPausado(document.hidden)
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])

  // Motor de reproducción: un timer por paso.
  useEffect(() => {
    if (!activo || pausado || estatico) return

    if (indice >= GUION.length) {
      const t = setTimeout(() => {
        setIndice(0)
        setVuelta((v) => v + 1)
      }, ESPERA_ANTES_DE_REPETIR)
      return () => clearTimeout(t)
    }

    const t = setTimeout(() => setIndice((i) => i + 1), GUION[indice].espera)
    return () => clearTimeout(t)
  }, [indice, activo, pausado, estatico])

  const visibles = useMemo(() => GUION.slice(0, indice), [indice])
  const tablero = useMemo(() => reducir(visibles), [visibles])

  const ultimo = visibles.at(-1)
  const fase = ultimo ? faseDe(ultimo) : 'configuracion'
  const enConfig = fase === 'configuracion'

  /**
   * El evento *pendiente* —el que aún no entró a `visibles`— es el que se está
   * tecleando. Cuando el timer global avanza, la línea entra completa al
   * tablero: por construcción no puede quedar cortada a media palabra.
   */
  const pendiente = GUION[indice] ?? null
  const tecleando = !estatico && pendiente?.tipo === 'escribe' ? pendiente.texto : null
  const tecleado = useEscritura(tecleando, activo && !pausado)

  /**
   * El hilo sigue al último mensaje sin arrastrar la página. Al reiniciar hay
   * que volver a cero explícitamente: el contenido se vacía pero el navegador
   * conserva el `scrollTop` y el panel se queda mirando un vacío.
   */
  useEffect(() => {
    const nodo = hilo.current
    if (!nodo) return
    nodo.scrollTop = indice === 0 ? 0 : Math.max(0, nodo.scrollHeight - nodo.clientHeight)
  }, [indice])

  const transcurrido = visibles.reduce((s, e) => s + e.espera, 0)
  const progreso = Math.min(100, (transcurrido / DURACION_MS) * 100)

  return (
    <div ref={ancla}>
      <VentanaOperacion
        modulo={enConfig ? 'constructor de agentes' : 'consola de operación'}
        estado={
          <PuntoEstado
            texto={enConfig ? (tablero.desplegando ? 'desplegando' : 'configurando') : 'en vivo'}
            vivo={!estatico}
          />
        }
        barraEstado={
          <BarraEstado
            enConfig={enConfig}
            tablero={tablero}
            caracteresEnCurso={tecleado.length}
            indice={indice}
            progreso={progreso}
            estatico={estatico}
            pausado={pausado}
            alPausar={() => setPausado((p) => !p)}
            alRepetir={() => {
              setIndice(0)
              setPausado(false)
              setVuelta((v) => v + 1)
            }}
          />
        }
      >
        <div className={estatico ? 'flex flex-col gap-8' : `grid ${ALTO}`}>
          <Capa visible={enConfig} estatico={estatico}>
            <FaseConfiguracion
              key={vuelta}
              tablero={tablero}
              escribiendo={tecleando ? { completa: tecleando, visible: tecleado } : null}
              estatico={estatico}
            />
          </Capa>

          <Capa visible={!enConfig} estatico={estatico}>
            <FaseOperacion key={vuelta} tablero={tablero} estatico={estatico} refHilo={hilo} />
          </Capa>
        </div>
      </VentanaOperacion>
    </div>
  )
}

/**
 * Telemetría del marco.
 *
 * Toda cifra sale de `reducir()` o del índice del guion. Ninguna constante
 * escrita a mano aquí: un contador inventado en la página de una empresa cuyo
 * único activo es "cada dato se puede probar" sale caro.
 */
function BarraEstado({
  enConfig,
  tablero,
  caracteresEnCurso,
  indice,
  progreso,
  estatico,
  pausado,
  alPausar,
  alRepetir,
}: {
  enConfig: boolean
  tablero: Tablero
  caracteresEnCurso: number
  indice: number
  progreso: number
  estatico: boolean
  pausado: boolean
  alPausar: () => void
  alRepetir: () => void
}) {
  const caracteres =
    tablero.instruccion.reduce((s, l) => s + l.length, 0) + caracteresEnCurso

  const enGestion = tablero.casos.filter((f) =>
    ['contactado', 'negociando', 'acuerdo'].includes(f.estado),
  ).length
  const cerrados = tablero.casos.filter((f) => f.estado === 'pagado').length

  const cifras = enConfig
    ? [
        `${numero(caracteres)} caracteres de instrucción`,
        `${tablero.cadencia.length}/${CADENCIA.length} pasos`,
        `${tablero.herramientas.length}/${HERRAMIENTAS.length} conexiones`,
      ]
    : [
        `${numero(tablero.casos.length)} casos`,
        `${numero(enGestion)} en gestión`,
        `${numero(cerrados)} cerrados`,
        `${cop(tablero.recaudadoCop)} recaudado`,
      ]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.6875rem] text-ink-faint">
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {cifras.map((c, i) => (
          <span key={i} data-cifra className="flex items-baseline gap-3">
            {i > 0 ? <span aria-hidden>·</span> : null}
            {c}
          </span>
        ))}
      </span>

      {estatico ? null : (
        <>
          <span data-cifra className="ml-auto shrink-0">
            {indice}/{GUION.length} eventos
          </span>
          <span className="h-px w-16 shrink-0 bg-rule sm:w-24" aria-hidden>
            <span
              className="block h-px bg-ink transition-[width] duration-300 ease-linear"
              style={{ width: `${progreso}%` }}
            />
          </span>
          <button
            type="button"
            onClick={alPausar}
            className="shrink-0 transition-colors hover:text-ink"
          >
            {pausado ? 'Reanudar' : 'Pausar'}
          </button>
          <button
            type="button"
            onClick={alRepetir}
            className="shrink-0 transition-colors hover:text-ink"
          >
            Repetir
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Las dos fases viven montadas a la vez en la misma celda de grid y se cruzan
 * por opacidad. `display: none` colapsaría el alto y devolvería el salto que
 * esto evita, así que la oculta se saca del árbol con `inert`.
 */
function Capa({
  visible,
  estatico,
  children,
}: {
  visible: boolean
  estatico: boolean
  children: React.ReactNode
}) {
  if (estatico) return <div className="border-t border-rule pt-6 first:border-0 first:pt-0">{children}</div>

  return (
    <div
      inert={!visible}
      aria-hidden={!visible}
      className={[
        'col-start-1 row-start-1 min-h-0 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
