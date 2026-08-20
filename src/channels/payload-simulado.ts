/**
 * Un payload de Meta armado a mano.
 *
 * Existe para que haya **un solo** camino de entrada. El script `pnpm simular` y
 * el botón de la consola no inyectan mensajes por su cuenta: arman el mismo
 * sobre que entrega la Cloud API y lo meten por `procesarWebhook`, que es la
 * función que corre cuando llama Meta de verdad. Lo que se ve en la demo es
 * entonces lo mismo que va a pasar en producción, incluidos los bugs.
 *
 * La alternativa —una acción que escriba el `Contacto` directo— sería más corta
 * y sería una segunda ruta de escritura que mantener, con su propia idea de qué
 * hacer con la ventana de 24 h, con el opt-out y con la idempotencia. Tres
 * cosas que ya están resueltas una vez.
 */

export interface EntranteSimulado {
  /** E.164, con o sin `+`. */
  telefono: string
  /** El número de la empresa en Meta. Es el discriminador de tenant del webhook. */
  phoneNumberId: string
  texto: string
  /** `wamid`. Es la llave de idempotencia: repetirlo hace que el segundo se ignore. */
  idProveedor: string
  ocurridoEn: Date
  /** Un comprobante. Meta manda el id del archivo, no el archivo. */
  imagen?: { id: string; mime?: string; caption?: string }
  nombrePerfil?: string
}

export function construirPayloadEntrante(e: EntranteSimulado): unknown {
  const waId = e.telefono.replace(/^\+/, '')
  const timestamp = String(Math.floor(e.ocurridoEn.getTime() / 1000))

  const mensaje = e.imagen
    ? {
        from: waId,
        id: e.idProveedor,
        timestamp,
        type: 'image',
        image: {
          id: e.imagen.id,
          mime_type: e.imagen.mime ?? 'image/jpeg',
          sha256: 'simulado',
          caption: e.imagen.caption ?? e.texto,
        },
      }
    : {
        from: waId,
        id: e.idProveedor,
        timestamp,
        type: 'text',
        text: { body: e.texto },
      }

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-simulada',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: waId, phone_number_id: e.phoneNumberId },
              contacts: [{ wa_id: waId, profile: { name: e.nombrePerfil ?? 'Deudor' } }],
              messages: [mensaje],
            },
          },
        ],
      },
    ],
  }
}
