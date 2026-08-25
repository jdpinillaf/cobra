/**
 * Las seis herramientas del agente, en el dialecto de Deepgram.
 *
 * Deepgram Voice Agent hace el `think`, pero **no decide nada**: el modelo solo
 * puede *pedir* que se ejecuten y quien aprueba sigue siendo `validarAcuerdo()`.
 * Un acuerdo a 12 cuotas se rechaza por teléfono igual que por WhatsApp.
 *
 * **`client_side` no se declara.** Se intentó mandarlo en `Settings` porque un
 * ejemplo de la documentación lo mostraba, y Deepgram responde
 * `UNPARSABLE_CLIENT_MESSAGE` señalando `agent.think`. El flag viaja al revés:
 * viene dentro del `FunctionCallRequest` para avisarnos que la ejecución es
 * nuestra. Una función sin `endpoint` **ya** es del lado del cliente.
 *
 * El error tardó en aparecer porque Deepgram manda `Welcome` apenas conecta y
 * **valida los ajustes después**: quien corte en el `Welcome` cree que pasó.
 *
 * Los parámetros **se derivan** de los `inputSchema` que ya existen, no se
 * reescriben. Dos listas de parámetros para las mismas herramientas es una
 * lista que algún día se desincroniza, y sería justo la que aplica los límites
 * de negociación.
 */
import { asSchema, type Tool } from 'ai'

export interface FuncionDeclarada {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type EstadoAccion = 'ok' | 'bloqueado' | 'error'

export interface AccionEjecutada {
  id: string
  nombre: string
  argumentos: unknown
  salida: unknown
  estado: EstadoAccion
  latenciaMs: number
  /** Lo que se le devuelve a Deepgram, ya serializado. */
  contenido: string
}

export interface PedidoDeFuncion {
  id: string
  name: string
  /** JSON serializado. Viene del modelo, así que es entrada no confiable. */
  arguments: string
}

type Herramientas = Record<string, Tool>

/**
 * Convierte los `inputSchema` a JSON Schema.
 *
 * Se usa `asSchema` del AI SDK y no `z.toJSONSchema` directo porque es la misma
 * conversión que el SDK le manda a OpenAI: si algún día un schema deja de ser
 * plano, las dos rutas siguen coincidiendo.
 */
export async function declararFunciones(
  herramientas: Herramientas,
  soloEstas?: readonly string[],
): Promise<FuncionDeclarada[]> {
  const nombres = soloEstas ?? Object.keys(herramientas)
  const salida: FuncionDeclarada[] = []

  for (const name of nombres) {
    const t = herramientas[name]
    if (!t?.inputSchema) continue

    const { jsonSchema } = asSchema(t.inputSchema)
    const parameters = { ...(await jsonSchema) } as Record<string, unknown>
    // `$schema` es metadato del validador y algunos proveedores lo rechazan.
    delete parameters.$schema

    salida.push({
      name,
      description: typeof t.description === 'string' ? t.description : name,
      parameters,
    })
  }

  return salida
}

/**
 * Ejecuta lo que pidió el modelo.
 *
 * **Nunca lanza.** Un throw acá deja al deudor escuchando silencio mientras
 * Deepgram espera un `FunctionCallResponse` que no va a llegar: la llamada se
 * muere muda, con el cliente del otro lado. Todo error se convierte en una
 * respuesta que desatasca la conversación.
 */
export async function ejecutarFuncion(
  herramientas: Herramientas,
  pedido: PedidoDeFuncion,
  ahora: () => number = Date.now,
): Promise<AccionEjecutada> {
  const arranque = ahora()
  const fin = (
    estado: EstadoAccion,
    salida: unknown,
    argumentos: unknown = null,
  ): AccionEjecutada => ({
    id: pedido.id,
    nombre: pedido.name,
    argumentos,
    salida,
    estado,
    latenciaMs: ahora() - arranque,
    contenido: JSON.stringify(salida),
  })

  let crudo: unknown
  try {
    // El modelo manda JSON roto de vez en cuando. Es esperable, no excepcional.
    crudo = pedido.arguments.trim() === '' ? {} : JSON.parse(pedido.arguments)
  } catch {
    return fin('error', { error: 'argumentos_invalidos', detalle: 'el JSON no se pudo leer' })
  }

  const t = herramientas[pedido.name]
  if (!t?.execute) {
    return fin('error', { error: 'herramienta_desconocida', nombre: pedido.name }, crudo)
  }

  /**
   * **El punto de carga del diseño.** El JSON del modelo es entrada no
   * confiable y este zod es la frontera. Sin este paso, un `montoAcordado`
   * que llega como `"un millón"` entra a `Math.round(monto / cuotas)` y
   * escribe `NaN` en la base — por voz es más probable que por texto, porque
   * el modelo transcribe lo que oyó.
   */
  const validacion = await asSchema(t.inputSchema).validate?.(crudo)
  if (validacion && !validacion.success) {
    return fin(
      'error',
      { error: 'argumentos_invalidos', detalle: String(validacion.error?.message ?? validacion.error) },
      crudo,
    )
  }
  const entrada = validacion?.success ? validacion.value : crudo

  try {
    const salida = await t.execute(entrada, {
      toolCallId: pedido.id,
      messages: [],
      // Ninguna de las seis herramientas lee el segundo argumento; el cast
      // evita arrastrar el tipo del SDK hasta acá solo para satisfacerlo.
      ...({} as Record<string, never>),
    } as never)

    /**
     * `bloqueado` no es un error: es la herramienta que corrió y dijo que no.
     * La pantalla lo distingue de «consultó» y de «se rompió», que es
     * exactamente lo que el cliente quiere ver del agente.
     */
    const rechazado =
      typeof salida === 'object' &&
      salida !== null &&
      'aceptado' in salida &&
      (salida as { aceptado: unknown }).aceptado === false

    return fin(rechazado ? 'bloqueado' : 'ok', salida, entrada)
  } catch (error) {
    return fin(
      'error',
      { error: 'fallo_al_ejecutar', detalle: error instanceof Error ? error.message : String(error) },
      entrada,
    )
  }
}
