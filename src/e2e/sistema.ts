/**
 * Arnés E2E de la conciliación.
 *
 * Los tests de acá no prueban una función, prueban el trato: un comerciante
 * recibe un comprobante y un aviso del banco, y algo tiene que pasar. Por eso
 * las aserciones son sobre lo observable — qué mensaje salió por WhatsApp, en
 * qué estado quedó el caso, qué se registró en agent_events — y nunca sobre
 * cómo está partido el código adentro.
 *
 * Las tres fronteras con el mundo van con doble de prueba, siguiendo lo que ya
 * hace `ProveedorSimulado` en src/channels:
 *
 *   WhatsApp saliente → ProveedorSimulado, registra en vez de enviar
 *   OCR              → lee el JSON que el fixture metió en la "imagen"
 *   reloj            → lo mueve el test, para no esperar el backoff real
 *
 * Todo lo demás es el código real: el parser, la autenticidad del correo, el
 * matcher y el repositorio. Si un E2E pasa con el matcher falso, no probó nada.
 *
 *   ┌── recibirWhatsApp ──┐
 *   │                     ├──► [ código real ] ──► mensajesA() / casos() / eventos()
 *   └── recibirCorreo ────┘            ▲
 *              avanzarReloj ───────────┘
 */

export type EstadoCaso = 'esperando' | 'aprobado' | 'revisar'

export interface TenantDePrueba {
  nombre: string
  cuentaUltimos4: string
  cuentaTitular: string
  aliasCorreo: string
  dkimDominioEsperado: string
}

export interface CasoVisible {
  id: string
  estado: EstadoCaso
  motivo: string
  montoCentavos: number | null
}

export interface EventoVisible {
  paso: string
  decision: string
  motivo: string
}

export interface Sistema {
  /** Llega una imagen por WhatsApp. `wamid` repetido simula la reentrega de Meta. */
  recibirWhatsApp(m: { de: string; wamid: string; imagen: string }): Promise<void>
  /** Llega un correo crudo al alias del tenant, tal como lo entregaría el Worker. */
  recibirCorreo(mimeCrudo: string): Promise<void>
  /** Mueve el reloj y corre el cron de reintentos. Sin esto no hay backoff testeable. */
  avanzarReloj(minutos: number): Promise<void>

  /** Lo que el deudor vio en su WhatsApp, en orden. */
  mensajesA(telefono: string): string[]
  casos(): CasoVisible[]
  eventos(casoId: string): EventoVisible[]
  /** Correos que no pasaron autenticidad. Nunca deben influir en un caso. */
  cuarentena(): number
}

export interface OpcionesSistema {
  tenant: TenantDePrueba
  /** Ventana de matching en minutos. La calibra el corpus; el test la fija. */
  ventanaMinutos?: number
  /** A los cuántos minutos sin aviso un caso pasa de `esperando` a `revisar`. */
  plazoMinutos?: number
}

export function crearSistema(_o: OpcionesSistema): Sistema {
  throw new Error('no implementado: crearSistema')
}
