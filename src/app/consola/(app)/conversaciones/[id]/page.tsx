import { notFound } from 'next/navigation'
import { requerirSesion } from '@/auth/actual'
import { Bloqueado, Burbuja, FONDO_CHAT, Nota } from '@/components/chat/Burbuja'
import { fechaCorta, horaDeReloj } from '@/components/demo/hora'
import { cop } from '@/lib/formato'
import { expedienteDeConversacion, hiloDeConversacion } from '@/repo/cobranza/conversaciones'
import { obtenerDb } from '@/repo/conexion'

export const dynamic = 'force-dynamic'

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="text-marca uppercase tracking-[0.14em] text-ink-faint">{etiqueta}</dt>
      <dd className={`text-right text-sm ${tono ?? 'text-ink'}`} data-cifra>
        {valor}
      </dd>
    </div>
  )
}

export default async function PaginaHilo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sesion = await requerirSesion()
  const db = await obtenerDb()

  const expediente = await expedienteDeConversacion(db, sesion.tenantId, id)
  if (!expediente) notFound()

  const hilo = await hiloDeConversacion(db, sesion.tenantId, id)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule-strong pb-3">
          <h2 className="font-serif text-lead">{expediente.deudorNombre}</h2>
          <span className="text-sm text-ink-faint" data-cifra>
            {expediente.telefono ?? 'sin teléfono'}
          </span>
          {expediente.agentePausado && (
            <span className="text-sm text-diferido">
              agente pausado{expediente.motivoPausa ? ` · ${expediente.motivoPausa}` : ''}
            </span>
          )}
          <span className="ml-auto text-sm text-ink-faint">
            {expediente.asignadaNombre ?? 'sin asignar'}
          </span>
        </header>

        <div
          className="mt-4 flex flex-col gap-1.5 rounded p-3"
          style={{ background: FONDO_CHAT }}
        >
          {hilo.length === 0 && (
            <p className="py-10 text-center text-sm text-neutral-600">Todavía no hay mensajes.</p>
          )}

          {hilo.map((e) =>
            e.tipo === 'nota' ? (
              <Nota key={e.id} cuerpo={e.cuerpo} autor={null} hora={horaDeReloj(e.ocurridoEn)} />
            ) : e.resultado === 'bloqueado' ? (
              <Bloqueado
                key={e.id}
                motivo={e.motivoBloqueo ?? 'bloqueado'}
                hora={horaDeReloj(e.ocurridoEn)}
              />
            ) : (
              <Burbuja
                key={e.id}
                mensaje={{
                  id: e.id,
                  direccion: e.direccion ?? 'saliente',
                  cuerpo: e.cuerpo,
                  hora: horaDeReloj(e.ocurridoEn),
                }}
              />
            ),
          )}
        </div>

        {/* El redactor llega con el envío manual y la ventana de 24 h. */}
        <p className="mt-3 text-sm text-ink-faint">
          Responder desde acá llega con el envío manual, que necesita el control de la ventana de
          24 horas de WhatsApp.
        </p>
      </div>

      <aside className="xl:border-l xl:border-rule xl:pl-6">
        <p className="marca-seccion">Expediente</p>
        <dl className="mt-3">
          <Dato etiqueta="Documento" valor={expediente.documento} />
          <Dato etiqueta="Crédito" valor={expediente.numeroCredito} />
          <Dato etiqueta="Saldo" valor={cop(expediente.saldoTotal)} />
          <Dato etiqueta="Días mora" valor={String(expediente.diasMora)} />
          <Dato etiqueta="Tramo" valor={expediente.tramo} />
          <Dato etiqueta="Vence" valor={fechaCorta(`${expediente.fechaVencimiento}T12:00:00-05:00`)} />
          <Dato
            etiqueta="Contactable"
            valor={expediente.contactable ? 'sí' : 'no'}
            tono={expediente.contactable ? 'text-entregado' : 'text-bloqueado'}
          />
        </dl>

        <p className="mt-6 text-sm text-ink-faint">
          Los intentos que la ley bloqueó aparecen en el hilo, centrados. Son la evidencia de que
          el sistema respetó la Ley 2300, y explican los huecos de la conversación.
        </p>
      </aside>
    </div>
  )
}
