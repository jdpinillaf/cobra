/**
 * Todo lo que cambia cuando cambia la marca vive aquí. Ningún componente
 * escribe el nombre, el dominio ni el correo a mano.
 */
export const MARCA = {
  nombre: 'Ponox',
  descriptor: 'Agentes especializados para empresas',
  dominio: 'ponox.co',
  correo: 'hola@ponox.co',
  /**
   * Link de agendamiento. Mientras esté vacío, la sección de agenda muestra el
   * correo como alternativa en vez de un iframe roto.
   */
  calendly: process.env.NEXT_PUBLIC_CALENDLY_URL ?? '',
} as const
