# Landing de Ponos — recorte de densidad y chrome de producto

> Aprobado 2026-08-11. Dos fases, en orden: primero el texto, después el marco.

## Contexto

La landing funciona pero se lee como un documento, no como un producto. Dos síntomas que resultaron ser el mismo:

1. *"Quiero que se vea más tecnológica"* (referencia: plaude.com, plataforma de agentes IA con inbox omnicanal y journeys de recuperación).
2. *"Hay mucho texto en la app."*

Medido sobre la página corriendo:

| Sección | Palabras |
|---|---|
| §03 Ley 2300 | 233 |
| §04 Cómo funciona | 196 |
| §07 Precios | 119 |
| §05 Simulador | 94 |
| §08 Agendar | 74 |
| Hero | 61 |

**Diez párrafos de entre 28 y 41 palabras.** Los cuatro más largos están en "Cómo funciona".

El patrón es el problema: las siete secciones tienen la misma forma —marca, titular, párrafo de 30-40 palabras. Para la tercera repetición el lector aprendió el patrón y se salta el párrafo, que es donde están los argumentos.

**Diagnóstico de fondo:** el concepto visual "expediente" es la causa de la densidad. Un expediente es prosa; un producto es interfaz. Por eso las dos peticiones son la misma, y por eso el texto va primero: el marco alrededor de las demos no mueve la aguja si al lado siguen cuatro párrafos de 40 palabras.

**Lo que no se toca:** color, tipografía, escala tipográfica, filetes. La tesis visual se queda.

## Decisiones tomadas

1. Recorte **agresivo**, objetivo ~50% menos prosa (≈900 → ≈450 palabras).
2. **Texto primero**, chrome después, en commits separados, para poder juzgar cuánto aporta cada uno.
3. Chrome = **ventana de operación** en lenguaje expediente: filete 1px, cero radios, cero sombras.

---

# Fase 1 — Recorte de texto

## 1.1 Eliminar `ComoFunciona.tsx` (§04, 196 palabras)

Es la sección con peor relación aporte/costo: cuenta en prosa lo que el `FlujoDemo` acaba de mostrar en vivo (carga → cadencia → negociación → pago). El visitante lo vio funcionando y después se lo explican por escrito.

**Rescatar una sola línea**, la que mata la objeción número uno:

> La plata **nunca** pasa por nosotros. La cuenta de recaudo es tuya.

Va justo **debajo del `FlujoDemo`**, no donde está hoy: ahí el visitante acaba de ver el link de Wompi generarse, así que la frase responde la pregunta en el momento exacto en que aparece.

`Nav.tsx` no enlaza a `#como`, así que borrarla no rompe navegación. Verificar que no queden anclas huérfanas.

## 1.2 Reescribir los párrafos de entrada

| Ubicación | Antes | Después |
|---|---|---|
| `Hero.tsx` | 38 pal. — *"Un agente que cobra por WhatsApp, negocia dentro de los límites que tú fijas y genera el link de pago contra tu propia pasarela. Y que no puede escribirle a un deudor un domingo aunque se lo pidas."* | **23** — *"Negocia dentro de tus límites y cobra contra tu propia pasarela. Y no puede escribirle a un deudor un domingo aunque se lo pidas."* |
| `page.tsx` §02 | 28 pal. — *"Ana debe $1.245.000 y lleva 22 días de mora. Abajo, en paralelo: lo que ve ella en su teléfono y lo que decide el motor en cada paso."* | **16** — *"Ana debe $1.245.000, 22 días de mora. Su teléfono a un lado, el motor al otro."* |
| `TablaLey2300.tsx` | 29 pal. — *"La Ley 2300 de 2023 rige desde el 10 de octubre de 2023 y la sanciona la SIC. Esto es cada regla y qué hace el sistema con ella."* | **9** — *"Rige desde octubre de 2023. La sanciona la SIC."* |
| `page.tsx` §05 | 22 pal. — *"El mismo motor que acabas de ver, corriendo un piloto completo en tu navegador contra un grupo de control. Pon tus números."* | **12** — *"El mismo motor, corriendo en tu navegador contra un grupo de control."* |
| `Simulador.tsx` §06 | 29 pal. — *"De los mensajes que la cadencia quiso enviar en esa misma corrida, estos no salieron cuando se pidieron. Cada uno queda registrado con fecha, hora de Bogotá y motivo."* | **15** — *"De esa misma corrida: lo que la cadencia pidió y la ley no dejó salir."* |
| `Agendar.tsx` | 29 pal. — *"Treinta minutos. Cargamos tu archivo real, mapeamos tus columnas y te mostramos qué cadencia saldría y qué mensajes bloquearía la ley. Si no cuadra, te lo decimos ahí mismo."* | **16** — *"Treinta minutos con tu archivo real. Te mostramos qué cadencia saldría y qué bloquearía la ley."* |

**La frase que se conserva entera** es *"Y no puede escribirle a un deudor un domingo aunque se lo pidas"*: es el pitch completo en una línea, donde la restricción se vende como característica. Recortarla sería recortar el producto.

## 1.3 Comprimir la tabla de la Ley 2300

Las siete reglas se quedan: son la sustancia y la prueba del diferencial. Lo que se recorta es la columna `motor`, hoy de 15 a 25 palabras. **Tope: 14 palabras.** Las tres que hoy se pasan:

- *"Su preferencia estrecha la ventana legal, nunca la amplía: si pide que le escriban hasta las 22:00, la ley sigue cortando a las 19:00."* (25) → *"Su preferencia estrecha la ventana legal, nunca la amplía."* (9)
- *"Calendario de festivos calculado con la Ley Emiliani y los móviles de Pascua, no una lista escrita a mano."* (19) → *"Festivos calculados con la Ley Emiliani y los móviles de Pascua."* (11)
- *"La ventana es móvil de 7 días, no semana calendario, y cuenta también los mensajes ya agendados a futuro."* (19) → *"Ventana móvil de 7 días. Cuenta también lo ya agendado."* (10)

La nota de habeas data del pie (*"Tú eres Responsable del tratamiento…"*) se mueve al `Footer`, donde va la letra chica.

## 1.4 Corregir lo que la migración a Meta dejó falso

Dos frases en `Precios.tsx` son hoy **incorrectas**, no solo largas:

- Línea 89: *"Nunca sale del cupo: cuesta nueve veces más que un WhatsApp."* → **65 veces**, no nueve. La brecha se abrió al pasar de COP 24 a COP 3,2 por plantilla.
- Líneas 99-103 (36 pal.): *"Un mensaje cuenta lo mismo si entra que si sale. El tráfico de las conversaciones es cerca de la mitad del costo real, y contarlo solo en una dirección sería venderte un cupo que no existe."* → El tráfico conversacional ahora es **gratis**; el párrafo justifica el cupo con un costo que ya no existe. Reemplazo (**9 pal.**): *"Un mensaje cuenta igual si entra que si sale."*

Se enuncia la regla y se deja de justificarla con una cifra falsa. Para un producto que vende *"te puedo probar cada dato"*, una cifra inventada en la página de precios es caro.

## 1.5 Mover la nota del grupo de control

`Simulador.tsx` tiene 34 palabras explicando el grupo de control debajo del botón. Es un argumento bueno en el lugar equivocado: compite con el CTA. Pasa a la barra de estado de la Fase 2, en versión corta: *"la mitad queda sin contactar, como control"* (8 pal.).

Hasta que exista la barra, vive como nota de pie del bloque de controles en `text-xs`.

## 1.6 Renumerar las secciones (y arreglar que hoy empiezan en §02)

Hallazgo de la auto-revisión: **hoy no existe ningún §01.** La numeración arranca en §02 porque el hero no lleva marca de sección, así que la página se lee como un articulado que empieza en el artículo 2. En un lenguaje visual que imita una norma, eso es un error visible.

Al caer "Cómo funciona" y corregir el arranque, queda:

| Antes | Después | Sección |
|---|---|---|
| §02 | **§01** | La demo |
| §03 | **§02** | El marco legal |
| §04 | — | ~~Cómo funciona~~ (eliminada) |
| §05 | **§03** | Tus números |
| §06 | **§04** | Anexo de compliance |
| §07 | **§05** | Precios |
| §08 | **§06** | Agendar |

El hero no recibe marca: es el titular del documento, no un artículo. Verificar que la secuencia quede consecutiva y que ningún `id` o ancla de `Nav.tsx` quede colgando.

---

# Fase 2 — Chrome de producto

Solo después de mirar el resultado de la Fase 1. Puede que con menos texto el marco aporte menos de lo previsto; si es así, se recorta el alcance.

## 2.1 `VentanaOperacion.tsx`

Componente nuevo, presentacional, sin estado.

```tsx
interface Props {
  modulo: string            // "motor de cadencia"
  estado?: ReactNode        // "● en vivo"
  barraEstado?: ReactNode   // telemetría + controles
  children: ReactNode
}
```

```
border border-ink                  ← el filete fuerte que ya abre secciones
├─ header  border-b border-ink     ← mismo peso: es parte del marco
│   "ponos · {modulo}"  …  {estado}
├─ {children}
└─ footer  border-t border-rule    ← filete liviano: es telemetría, no contenido
```

Cero `rounded-*`, cero `shadow-*`. El único redondeo es el punto de estado de 6px, que ya existe en el repo (`FlujoDemo.tsx:314`).

## 2.2 La barra de estado lleva cifras reales

Es lo que separa el chrome de la decoración. Nada inventado:

- **FlujoDemo** — `{indice}/{GUION.length} eventos` · `guard: N bloqueos` (contados sobre `visibles`) · progreso · pausar/repetir, que hoy cuelgan sueltos debajo.
- **Simulador** — `{deudores} deudores` · `{dias} días` · `{ms} ms de cómputo` · `{mensajes.total} mensajes`. El `ms` ya se mide y se pasa a `Resultados`.

Un visitante técnico ve *"43 ms de cómputo"* y entiende que corrió en su máquina. Eso no lo finge un competidor con un video.

## 2.3 Cambios por componente

**`FlujoDemo.tsx`** — envolver el grid de paneles. Los encabezados internos pierden su `border-t border-ink` (lo aporta el marco) y pasan a `border-b border-rule`. El separador entre paneles se vuelve filete vertical real: `lg:border-l lg:border-rule` en el panel derecho, quitando el `gap-x-10` para que llegue de arriba abajo. En móvil, apilado, desaparece.

Beneficio lateral medido: hoy los dos paneles vacíos se leen como *"esto no cargó"*. Con marco y `0/24 eventos`, un panel vacío se lee como un sistema que aún no procesó nada, que es la verdad.

**`Simulador.tsx`** — envolver solo el bloque controles + resultados (~líneas 110-181). Estado `● corriendo` / `● listo` según el flag `corriendo` que ya existe. **El anexo queda fuera del marco**: es su propia sección con su propio título, y encerrarlo rompería la narrativa de "esto es el entregable".

## 2.4 Móvil y accesibilidad

En 375px el marco más padding le come ancho al chat, que es la mitad que engancha. Solución: `-mx-6` en móvil para que la ventana sangre a los bordes de la pantalla. **Hay que medirlo, no asumirlo.**

El marco es decorativo: los encabezados internos conservan su jerarquía, el punto de estado va `aria-hidden`, y la barra de estado `aria-live="off"` — nadie quiere un lector de pantalla cantando 24 eventos.

---

## Fuera de alcance

- Color, tipografía y escala tipográfica.
- Retícula de puntos, degradados, tarjetas y cualquier otro préstamo de plaude.com.
- Muro de logos, cifras de clientes y casos con nombre: **Ponos no tiene clientes todavía**, e inventarlos contradice el único activo que vende (poder probar cada dato).
- Sidebar de navegación falso: vende un panel de operación que aún no existe.

## Verificación

1. `pnpm build` y `pnpm lint` limpios. Node 22 (`nvm use`): con Node 20 el toolchain falla en el arranque.
2. Recuento de palabras antes/después con el mismo script que produjo la tabla de arriba. **Criterio de aceptación: ≤ 500 palabras de prosa**, contra ~900 de hoy.
3. Revisión visual con `/browse` en 375 / 768 / 1440, comparando contra las capturas de hoy en el scratchpad. Nota operativa: `screenshot --viewport` tras un scroll por `js` devuelve un cuadro en blanco en esta versión de browse; usar `prettyscreenshot --scroll-to <sel>`.
4. Verificar que la numeración de secciones quede consecutiva y sin anclas huérfanas.
5. Ningún test automatizado: no hay testing de componentes en el repo y no se monta testing-library para esto.

## Riesgos

- **Cortar argumentos que cierran ventas.** Mitigación: los recortes de arriba están escritos palabra por palabra, no delegados. La frase del domingo y la de "la plata nunca pasa por nosotros" se conservan explícitamente.
- **Que el marco encajone la página** y le quite el aire editorial. Mitigación: fases separadas, en commits separados, revisando entre una y otra.
