/**
 * La frontera entre las dos convenciones de dinero del sistema.
 *
 * El dominio trabaja en **pesos enteros** y el esquema en **centavos**
 * (`*_centavos bigint`). Convertir en el borde, y no migrar los tipos, es lo
 * que permite que el motor de cadencia y el guard —escritos y probados antes de
 * que existiera la base— sigan sin tocarse. Aguas afuera nadie ve un centavo.
 *
 * Vive acá y no dentro de un repositorio porque hay más de un borde: la cartera
 * escribe obligaciones y el agente escribe acuerdos, y las dos conversiones
 * tienen que ser la misma. Dos copias de esto es una copia que algún día
 * redondea distinto, y la diferencia se ve en un acuerdo de pago.
 */

export const aCentavos = (pesos: number): number => Math.round(pesos * 100)

export const aPesos = (centavos: string | number): number => Math.round(Number(centavos) / 100)
