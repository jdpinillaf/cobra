/**
 * Lo que separa un agente que rinde de uno que parece rendir.
 *
 * Un agente sin registro no se puede corregir: no se sabe qué paso aportó, cuál
 * sobraba, ni por qué se detuvo. Por eso esta sección no habla de auditoría
 * sino de eficiencia — es el mismo hecho visto desde donde le duele al cliente.
 */
const REGISTRO = [
  {
    que: 'Cada decisión con su motivo',
    porque: 'Por qué escribió, por qué esperó y por qué escaló. Nunca un “falló” sin causa.',
  },
  {
    que: 'Lo que no salió, también',
    porque: 'Un intento bloqueado queda registrado igual que uno enviado. Es la mitad que nadie muestra.',
  },
  {
    que: 'Costo real por conversación',
    porque: 'Medido contra la tarifa del proveedor, no estimado. Sabes lo que cuesta cada caso cerrado.',
  },
  {
    que: 'Qué paso del plan rinde y cuál no',
    porque: 'Cada paso con su tasa de respuesta. Lo que no aporta se corta.',
  },
  {
    que: 'Aprobación humana con traza',
    porque: 'Quién aprobó qué y cuándo. El agente no cierra solo lo que no le autorizaste.',
  },
] as const

export function Observabilidad() {
  return (
    <section id="observabilidad" className="scroll-mt-24">
      <p className="marca-seccion">§03 · Observabilidad</p>
      <h2 className="mt-4 max-w-[22ch] text-title">
        Todo lo que hace queda escrito. <em className="font-serif italic">Y por qué lo hizo</em>.
      </h2>
      <p className="medida mt-5 text-ink-soft">
        No es un log de mensajes. Es el registro de cada decisión, con su motivo.
      </p>

      <dl className="mt-14">
        {REGISTRO.map((r) => (
          <div
            key={r.que}
            className="grid gap-x-14 gap-y-1 border-t border-rule py-4 md:grid-cols-12"
          >
            <dt className="md:col-span-5">{r.que}</dt>
            <dd className="text-sm leading-relaxed text-ink-soft md:col-span-7">{r.porque}</dd>
          </div>
        ))}
      </dl>

      <p className="medida mt-12 border-t border-ink pt-6 text-lead">
        Sin esto, un agente es una caja negra a la que le pagas por fe. Con esto, cada peso gastado
        tiene una línea que lo explica, y el paso que no rinde se ve{' '}
        <em className="font-serif italic">antes</em> de que cueste un mes.
      </p>
    </section>
  )
}
