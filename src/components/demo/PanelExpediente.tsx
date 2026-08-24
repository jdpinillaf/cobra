import type { VistaConversacion } from '@/demo/vista'
import { fechaCorta, horaDeRegistro } from './hora'

/**
 * El panel es lo que vende.
 *
 * Sin él, un cliente ve un chat que responde bien y piensa "esto lo hace
 * ChatGPT". Con él ve lo que el agente consultó antes de abrir la boca: el
 * saldo real, los días de mora, qué autorizó el deudor, hasta dónde puede
 * negociar, y qué decidió el guard de la Ley 2300. Eso no lo hace ChatGPT.
 *
 * Va con el lenguaje visual del producto —papel, filetes de un pixel, cifras
 * tabulares— para que contraste con el teléfono y quede claro qué es de quién.
 */

const cop = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

const ETIQUETA_ESTADO: Record<VistaConversacion['estadoCaso'], string> = {
  en_cola: 'En cola',
  contactado: 'Contactado',
  negociando: 'Negociando',
  espera: 'En espera',
  acuerdo: 'Acuerdo',
  pagado: 'Pagado',
  humano: 'Con una persona',
}

const COLOR_ESTADO: Record<VistaConversacion['estadoCaso'], string> = {
  en_cola: 'text-ink-faint',
  contactado: 'text-ink-soft',
  negociando: 'text-diferido',
  espera: 'text-ink-soft',
  acuerdo: 'text-diferido',
  pagado: 'text-entregado',
  humano: 'text-bloqueado',
}

export function PanelExpediente({ vista }: { vista: VistaConversacion }) {
  const { expediente: e, limites: l } = vista

  /**
   * Las secciones §05 y §06 solo existen si la conversación llegó ahí, así que
   * el número no puede ir escrito a mano: sin acuerdo, la traza tiene que ser
   * §05 y no §07. Un contador evita el error de tener dos §05 en pantalla.
   */
  let siguiente = 4
  const nro = () => String(++siguiente).padStart(2, '0')

  return (
    <div className="flex flex-col gap-8">
      <Seccion numero="01" titulo="Quién escribe" pie="Cruce del celular contra la cartera">
        <Dato etiqueta="Nombre" valor={e.nombre} />
        <Dato etiqueta="Documento" valor={`CC ${e.documento}`} />
        <Dato etiqueta="Crédito" valor={e.numeroCredito} />
        <Dato etiqueta="Estado del caso">
          <span className={`font-medium ${COLOR_ESTADO[vista.estadoCaso]}`}>
            {ETIQUETA_ESTADO[vista.estadoCaso]}
          </span>
        </Dato>
      </Seccion>

      <Seccion numero="02" titulo="Qué debe" pie="Cifras del sistema, no del chat">
        <Dato etiqueta="Saldo total" valor={cop(e.saldoTotal)} destacado />
        <Dato etiqueta="Capital" valor={cop(e.capital)} />
        <Dato etiqueta="Interés de mora" valor={cop(e.interesMora)} />
        <Dato etiqueta="Días de mora" valor={String(e.diasMora)} />
        <Dato etiqueta="Venció el" valor={e.fechaVencimiento} />
        <Dato etiqueta="Tramo" valor={e.tramo} />
      </Seccion>

      <Seccion
        numero="03"
        titulo="Hasta dónde puede negociar"
        pie="Lo fija el cliente. El agente no lo puede exceder."
      >
        <Dato etiqueta="Cuotas máximo" valor={String(l.cuotasMax)} />
        <Dato
          etiqueta="Descuento máximo"
          valor={l.descuentoMaxPct === 0 ? 'Ninguno' : `${l.descuentoMaxPct}%`}
        />
        <Dato etiqueta="Plazo máximo" valor={`${l.diasPlazoMax} días`} />
        <Dato etiqueta="Abono mínimo" valor={cop(l.montoMinimoAbono)} />
      </Seccion>

      <Seccion
        numero="04"
        titulo="Consentimiento"
        pie="Ley 2300 · sin esto no sale ningún mensaje"
      >
        <Dato
          etiqueta="Autorizó"
          valor={e.consentimiento.otorgado ? `Sí · ${e.consentimiento.fuente}` : 'No'}
        />
        <Dato
          etiqueta="Revocó"
          valor={e.consentimiento.revocadoEn ? fechaCorta(e.consentimiento.revocadoEn) : 'No'}
        />
        <Dato etiqueta="Contactos previos" valor={String(e.contactosPrevios)} />
        <Dato etiqueta="Registros de auditoría" valor={String(vista.auditoria)} />
      </Seccion>

      {vista.acuerdo && (
        <Seccion numero={nro()} titulo="Acuerdo" pie="Dentro de los rangos autorizados">
          <Dato etiqueta="Total" valor={cop(vista.acuerdo.montoAcordado)} destacado />
          <Dato etiqueta="Cuotas" valor={String(vista.acuerdo.numeroCuotas)} />
          <Dato etiqueta="Descuento" valor={`${vista.acuerdo.descuentoPct}%`} />
          <Dato etiqueta="Primera cuota" valor={vista.acuerdo.primeraCuotaEl ?? '—'} />
        </Seccion>
      )}

      {vista.pago && (
        <Seccion numero={nro()} titulo="Cobro" pie="La referencia amarra el pago a la factura">
          <Dato etiqueta="Referencia" valor={vista.pago.referencia} />
          <Dato etiqueta="Monto" valor={cop(vista.pago.monto)} destacado />
          <Dato etiqueta="Estado">
            <span
              className={
                vista.pago.estado === 'aprobado'
                  ? 'font-medium text-entregado'
                  : 'text-ink-soft'
              }
            >
              {vista.pago.estado}
            </span>
          </Dato>
          {vista.pago.estado === 'aprobado' && (
            <Dato
              etiqueta="Atribuido al agente"
              valor={vista.pago.atribuidoAlAgente ? 'Sí' : 'No'}
            />
          )}
        </Seccion>
      )}

      <Seccion
        numero={nro()}
        titulo="Qué hizo el agente"
        pie="Cada paso queda con fecha, hora de Bogotá y motivo"
      >
        {vista.traza.length === 0 ? (
          <p className="py-2 text-sm text-ink-faint">
            Todavía nada. Responde algo desde el teléfono.
          </p>
        ) : (
          <ol className="flex flex-col" data-traza>
            {vista.traza.map((paso) => (
              <li
                key={paso.id}
                className="animar-entrada flex gap-3 border-b border-rule py-2.5 last:border-b-0"
              >
                <span
                  className={`mt-1.5 size-1.5 shrink-0 ${
                    paso.estado === 'bloqueado' ? 'bg-bloqueado' : 'bg-entregado'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{paso.herramienta}</p>
                  <p className="text-[13px] leading-snug text-ink-soft">{paso.detalle}</p>
                </div>
                <span className="ml-auto shrink-0 text-[11px] text-ink-faint" data-cifra>
                  {horaDeRegistro(paso.ts)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  )
}

function Seccion({
  numero,
  titulo,
  pie,
  children,
}: {
  numero: string
  titulo: string
  pie: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3 border-b border-rule-strong pb-2">
        <span className="marca-seccion">§{numero}</span>
        <h2 className="text-[15px] font-medium">{titulo}</h2>
        <p className="ml-auto hidden text-[11px] text-ink-faint sm:block">{pie}</p>
      </div>
      {children}
    </section>
  )
}

function Dato({
  etiqueta,
  valor,
  destacado,
  children,
}: {
  etiqueta: string
  valor?: string
  destacado?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <span className="text-[13px] text-ink-soft">{etiqueta}</span>
      <span className={`text-right text-[13px] ${destacado ? 'font-medium' : ''}`} data-cifra>
        {children ?? valor}
      </span>
    </div>
  )
}

