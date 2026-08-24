import { dominiosDkimDeclarados, parsearMime } from './mime'

/**
 * ¿Este correo lo escribió el banco?
 *
 * Es la pregunta de la que cuelga todo el antifraude, y por eso es un puerto y
 * no una función suelta.
 *
 * El ataque que esto para no es un comprobante falso: es peor. El buzón está
 * abierto a internet, así que quien conozca el alias puede mandar un correo con
 * el `From` de Bancolombia y el texto "recibiste una transferencia por
 * $900.000", y el sistema confirmaría un pago que nunca existió. Ataca la
 * fuente de validación, no el dato validado.
 *
 * Contra eso hay una sola defensa que no se puede falsificar: la **firma
 * criptográfica del dominio del banco**. El `From` se escribe a mano; la firma
 * no, porque exige la clave privada de `notificacionesbancolombia.com`.
 *
 * **Por qué es un puerto y no `mailauth` a secas.** Todo el plan descansa en
 * que esa firma sobreviva al reenvío de Gmail, y eso no está probado: si Gmail
 * re-codifica el cuerpo al reenviar, el sello deja de cuadrar y hay que leer el
 * original por IMAP. Las dos rutas responden la misma pregunta y devuelven lo
 * mismo, así que el motor no se entera de cuál ganó. Descubrirlo con el parser
 * ya escrito obligaría a rehacer la ingesta, que es la base de todo lo demás.
 */

export interface ResultadoVerificacion {
  /** Hay una firma válida del dominio esperado. Lo único que autoriza a conciliar. */
  autentico: boolean
  /** El dominio que firmó y verificó, si alguno lo hizo. */
  dominio: string | null
  /** Para `raw_emails.motivo` y para `agent_events`. Nunca se descarta en silencio. */
  motivo: string
}

export interface VerificadorCorreo {
  readonly nombre: string
  /**
   * `crudo` son los bytes exactos que llegaron. No normalizados, no
   * re-serializados: DKIM se calcula sobre ellos y cualquier conversión de
   * charset rompe el hash del cuerpo y hace fallar la firma sin motivo aparente.
   */
  verificar(crudo: string, dominioEsperado: string): Promise<ResultadoVerificacion>
}

/**
 * El de producción: verificación criptográfica de verdad.
 *
 * `mailauth` resuelve la clave pública por DNS y recalcula el hash. Se corre acá
 * y no en el Worker de Cloudflare a propósito: verificar DKIM quema CPU y el
 * Worker tiene un techo bajo. El Worker valida el alias, que es barato, y el
 * resto pasa por el API.
 *
 * **SPF no sirve para esto.** El reenvío de Gmail lo rompe siempre, por diseño:
 * el correo llega desde los servidores de Google y no desde los del banco. Es
 * exactamente el caso para el que existe DKIM, que firma el contenido y no el
 * camino.
 */
export class VerificadorMailauth implements VerificadorCorreo {
  readonly nombre = 'mailauth'

  async verificar(crudo: string, dominioEsperado: string): Promise<ResultadoVerificacion> {
    let resultado: {
      dkim?: { results?: Array<{ status?: { result?: string }; signingDomain?: string }> }
    }

    try {
      // Import dinámico: `mailauth` arrastra su propio resolvedor de DNS y no
      // hace falta cargarlo en los procesos que nunca ven un correo.
      const { authenticate } = await import('mailauth')
      resultado = (await authenticate(crudo, { trustReceived: false })) as typeof resultado
    } catch (error) {
      // Un fallo del verificador **no** es un correo auténtico. Ante la duda,
      // cuarentena: el costo de un falso negativo es que alguien mire un caso;
      // el de un falso positivo es confirmar un pago inventado.
      const detalle = error instanceof Error ? error.message : String(error)
      return { autentico: false, dominio: null, motivo: `no se pudo verificar la firma: ${detalle}` }
    }

    const firmas = resultado.dkim?.results ?? []
    if (firmas.length === 0) {
      return { autentico: false, dominio: null, motivo: 'el correo no trae firma DKIM' }
    }

    // Un correo reenviado trae varias firmas —la del banco y la de cada
    // reenviador— y son todas legítimas. Lo que importa es que la del banco
    // esté y haya pasado.
    const delBanco = firmas.find(
      (f) => (f.signingDomain ?? '').toLowerCase() === dominioEsperado.toLowerCase(),
    )

    if (!delBanco) {
      const vistos = firmas.map((f) => f.signingDomain ?? '?').join(', ')
      return {
        autentico: false,
        dominio: null,
        motivo: `firmado por ${vistos}, no por ${dominioEsperado}`,
      }
    }

    if (delBanco.status?.result !== 'pass') {
      return {
        autentico: false,
        dominio: dominioEsperado,
        motivo: `la firma de ${dominioEsperado} no verifica: ${delBanco.status?.result ?? 'sin resultado'}`,
      }
    }

    return { autentico: true, dominio: dominioEsperado, motivo: 'firma válida del banco' }
  }
}

/**
 * El doble, para los tests y el E2E.
 *
 * Lee lo que la cabecera **declara** en vez de verificar nada, siguiendo la
 * convención del fixture: `bh=ROTA` simula una firma que no cuadra. Es el mismo
 * papel que `ProveedorSimulado` en `src/channels`.
 *
 * Que sea un doble no lo hace un test de mentira: el camino que se ejercita —
 * quién decide, con qué dominio esperado, qué pasa después— es el real. Lo
 * único simulado es la criptografía, que no es lo que este producto tiene que
 * probar que funciona.
 */
export class VerificadorDeclarado implements VerificadorCorreo {
  readonly nombre = 'declarado'

  async verificar(crudo: string, dominioEsperado: string): Promise<ResultadoVerificacion> {
    const correo = parsearMime(crudo)
    const firmas = correo.cabeceras['dkim-signature'] ?? []

    if (firmas.length === 0) {
      return { autentico: false, dominio: null, motivo: 'el correo no trae firma DKIM' }
    }

    const dominios = dominiosDkimDeclarados(correo)
    const esperado = dominioEsperado.toLowerCase()
    const indice = dominios.indexOf(esperado)

    if (indice === -1) {
      return {
        autentico: false,
        dominio: null,
        motivo: `firmado por ${dominios.join(', ') || '?'}, no por ${dominioEsperado}`,
      }
    }

    if (/bh\s*=\s*ROTA/i.test(firmas[indice])) {
      return {
        autentico: false,
        dominio: esperado,
        motivo: `la firma de ${dominioEsperado} no verifica: bodyhash`,
      }
    }

    return { autentico: true, dominio: esperado, motivo: 'firma válida del banco' }
  }
}

/**
 * Cuál se usa. **El default es el real, al revés que en `crearProveedores`.**
 *
 * La asimetría es deliberada y vale la pena entenderla, porque copiar la
 * convención del canal acá abriría el agujero que este archivo existe para
 * tapar.
 *
 * En `src/channels`, el default simulado es el seguro: un entorno mal
 * configurado **no manda** mensajes. Acá es al revés. El doble responde que sí
 * a cualquier correo que *declare* venir del banco, y declarar es justamente lo
 * que el atacante puede hacer. Un entorno sin configurar con el doble adentro
 * no deja de confirmar pagos: confirma **todos**, incluidos los inventados.
 *
 * Así que el que hay que pedir explícitamente es el doble, y en producción ni
 * pidiéndolo.
 */
export function crearVerificador(
  env: { VERIFICADOR_CORREO?: string; NODE_ENV?: string } = process.env,
): VerificadorCorreo {
  if (env.VERIFICADOR_CORREO !== 'declarado') return new VerificadorMailauth()

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'VERIFICADOR_CORREO=declarado en producción: eso acepta como buena cualquier ' +
        'firma que el correo diga tener, que es exactamente el ataque.',
    )
  }

  return new VerificadorDeclarado()
}
