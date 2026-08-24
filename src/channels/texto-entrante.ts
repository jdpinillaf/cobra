/**
 * Cómo se lee lo que el deudor escribió.
 *
 * Los deudores contestan desde el celular: "BAJA!!", "no más", "NoMasMensajes",
 * "yo no soy, ese número está equivocado". Comparar el texto crudo dejaría
 * pasar casi todas las variantes.
 *
 * Vive en su propio módulo porque lo usan **dos detectores de cumplimiento** —
 * la baja y el número errado— y los dos deciden si se le sigue escribiendo a
 * una persona. Dos copias de esta función es una copia que algún día se mejora
 * sola: alguien agrega el manejo de emojis en una, la otra deja de matchear, y
 * el sistema sigue contactando a quien pidió que no.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
