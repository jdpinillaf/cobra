/**
 * El catálogo. Una línea por agente y nada más: la demo de arriba ya mostró
 * cómo se construye cualquiera de ellos, así que aquí sobra la prosa.
 */
const AGENTES = [
  {
    nombre: 'Cobranza',
    linea: 'Recupera cartera, negocia dentro de tus rangos y cobra contra tu propia pasarela.',
    nota: 'Es el que corre en la demo de arriba.',
  },
  {
    nombre: 'Datos',
    linea: 'Ingiere Excel, ERP o CRM y responde preguntas de negocio sobre eso.',
  },
  {
    nombre: 'Soporte',
    linea: 'Atiende post-venta y escala a una persona cuando se sale de lo que sabe.',
  },
  {
    nombre: 'Back-office',
    linea: 'Concilia, radica y cierra los trámites repetitivos que hoy hace alguien a mano.',
  },
] as const

export function Agentes() {
  return (
    <section id="agentes" className="scroll-mt-24">
      <p className="marca-seccion">§02 · Los agentes</p>
      <h2 className="mt-4 max-w-[20ch] text-title">
        El agente que tu operación <em className="font-serif italic">necesite</em>.
      </h2>

      <div className="mt-14 grid gap-x-14 gap-y-8 md:grid-cols-2">
        {AGENTES.map((a) => (
          <div key={a.nombre} className="border-t border-ink pt-5">
            <h3 className="text-lg tracking-tight">{a.nombre}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{a.linea}</p>
            {'nota' in a ? <p className="mt-2 text-xs text-ink-faint">{a.nota}</p> : null}
          </div>
        ))}
      </div>

      <p className="medida mt-12 border-t border-rule pt-6 text-sm text-ink-soft">
        Implementación uno a uno. Cada agente sale con tus reglas, tus cuentas y tu marca; nada
        corre sobre infraestructura compartida con otro cliente.
      </p>
    </section>
  )
}
