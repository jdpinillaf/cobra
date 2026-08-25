# Demo del agente — runbook

Cómo montar, ensayar y presentar la demo del agente de cobranza.

---

## 1. Antes de empezar (10 minutos)

Crea `.env.local` en la raíz:

```bash
# Una de las dos basta. Si están las dos, manda CEREBRO_PROVEEDOR.
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...

CEREBRO_PROVEEDOR=openai        # openai | anthropic
CEREBRO_MODELO=gpt-5.6-luna     # por defecto: gpt-5 u ojo claude-sonnet-5

# Dominio que ve el deudor en el link de pago. Solo cambia el texto del
# mensaje; la página se sigue sirviendo desde donde corra la app. Sin esto sale
# un `localhost:3000` que delata la demo.
URL_PUBLICA_PAGOS=https://pagos.creditosdelvalle.co

# Chatwoot — opcional. Sin esto la demo funciona igual, solo no hay consola.
CHATWOOT_URL=https://app.chatwoot.com
CHATWOOT_ACCOUNT_ID=
CHATWOOT_TOKEN=
CHATWOOT_INBOX_IDENTIFIER=

# 'guionado' apaga el modelo y usa respuestas fijas. La red de seguridad.
CEREBRO=llm
```

Levanta la demo:

```bash
pnpm dev     # → http://localhost:3000/demo
```

Si no hay ninguna llave, o el modelo falla, el agente **no se cae**: cae solo a
las respuestas guionadas y lo deja anotado en el panel. Se nota en el panel, no
en el teléfono.

### Grabar el video

```bash
nvm use                                # Node 22: con 20 no arranca nada
pnpm build && PORT=3100 pnpm start     # producción: sin el indicador de dev
pnpm grabar                            # → video/*.mp4
pnpm grabar -- --url http://localhost:3200   # si 3100 está ocupado
```

Salen **siete clips**, uno por caso, numerados en el orden en que conviene
mostrarlos:

| Archivo | Qué muestra |
|---|---|
| `ponox-01-negociacion.mp4` | El arco completo: cruza la cartera, negocia dentro de rango, manda el link y la confirmación del pago **llega sola** |
| `ponox-02-pago.mp4` | El checkout, solo |
| `ponox-03-escalamiento.mp4` | Pide 12 cuotas. Fuera de lo autorizado: el agente no regatea, escala |
| `ponox-04-numero-errado.mp4` | «Yo no soy Jorge». Marca el número y se calla |
| `ponox-05-baja.mp4` | Pide la baja. Se despide una vez y no vuelve a escribir |
| `ponox-06-ya-pague.mp4` | «Ya pagué eso». No confirma nada: suspende la gestión y escala |
| `ponox-07-landing.mp4` | La landing con el hero 3D y dos vueltas de la demo animada |

Los tres del medio terminan con un mensaje del deudor que el agente **no
contesta**. Ese plano es el que hay que dejar correr: cualquiera muestra lo que
el agente sí manda; lo que el cliente pregunta es qué pasa cuando el deudor dice
que no.

El navegador corre sin cabeza, así que en el video no aparece barra de
direcciones, ni escritorio, ni ninguna otra ventana.

Tres cosas que cuestan una regrabada si se olvidan:

- Hay que grabar contra `pnpm start`, no `pnpm dev`. El servidor de desarrollo
  pinta un indicador flotante de Next en la esquina que se cuela en la toma.
- Se graba `/demo?limpio=1`, que oculta los botones del guion y deja solo la
  barra de escritura. Con `/demo` a secas quedan los botones, que es lo que
  sirve para presentar en vivo.
- Si quedó un `next start` viejo del repo escuchando en el puerto, sirve un
  build vencido y `/demo` responde 404. Se ve en el primer clip y no antes.

El script imprime el `estadoCaso` con el que quedó cada conversación. En los
clips 03, 04 y 05 tiene que decir `humano`: es lo que confirma que el agente
soltó la conversación de verdad y que el silencio del final no es el modelo
tardando.

---

## 2. Chatwoot (opcional, pero es lo que impresiona)

Chatwoot es la consola del equipo de cobranza. Sin ella la demo se sostiene; con
ella el cliente ve que detrás hay una operación, no un bot suelto.

1. Cuenta en `app.chatwoot.com`. Ponle de nombre el del cliente ficticio.
2. **Inboxes → Add Inbox → API**. Nómbralo "WhatsApp — Cobranza".
   Copia el `inbox_identifier` → `CHATWOOT_INBOX_IDENTIFIER`.
3. **Profile Settings → Access Token** → `CHATWOOT_TOKEN`.
   El número de la cuenta sale de la URL (`/app/accounts/**3**/…`) → `CHATWOOT_ACCOUNT_ID`.
4. **Settings → Labels**, crea: `contactado`, `negociando`, `acuerdo-propuesto`,
   `pagado`, `escalado`, `en-espera`.
5. **Settings → Integrations → Webhooks → Add**:
   URL `https://TU-DEPLOY/api/chatwoot/webhook`, evento `Message created`.
   Sin deploy público esto no llega — el relevo humano necesita URL accesible.
6. Ponle avatar y nombre al agente. Que **no** diga "bot".

Con esto, cada conversación aparece en Chatwoot con etiquetas y con el saldo, la
mora y el tramo del deudor en el panel lateral. Y lo que un asesor escriba desde
ahí sale en el teléfono en menos de dos segundos.

---

## 3. El guion (unos 4 minutos)

### Acto 1 — de dónde salen las cifras · 30 s

```bash
pnpm demo -- --deudores 500 --dias 90
```

Muestra recuperación contra **grupo de control** (la mitad de la cartera sin
contactar, para no atribuirse pagos que iban a entrar solos), el costo real de
los mensajes, y el anexo de Ley 2300 con cada envío que el guard bloqueó y por
qué.

> «Esto no es una proyección de PowerPoint. Es una simulación con grupo de
> control: la mitad de la cartera no se contacta, para poder decir qué parte
> recuperó el agente y qué parte iba a entrar de todos modos.»

### Acto 2 — el teléfono · 2 min

En `/demo`, botones en este orden:

| # | Botón | Qué mostrar en el panel |
|---|---|---|
| 1 | *No tengo cómo pagar todo de una* | §01 y §02: cruzó el celular contra la cartera. Saldo y mora son del sistema, no del chat. |
| 2 | *¿Y si me lo dejan en 8 cuotas?* | §03: el cliente autorizó 4. El agente **no regatea**: escala. |
| 3 | *Reiniciar* y volver al 1 | — |
| 4 | *Listo, hagámosle en dos* | §05 el acuerdo, §06 la referencia `COB-…` |
| 5 | Abrir el link, pagar | El teléfono recibe la confirmación **solo**. §02 baja el saldo, §06 dice "atribuido al agente". |

La frase que hay que decir en el paso 5:

> «La referencia es lo que amarra el pago a la factura. Por eso se concilia solo:
> nadie está cruzando un extracto contra una lista de créditos.»

Y sobre la plata:

> «El link va contra su pasarela y su cuenta. La plata nunca pasa por nosotros.»

### Acto 3 — la consola · 1 min

Chatwoot al lado. La misma conversación, etiquetada, con los datos del deudor.
Escribe algo como asesor → **aparece en el teléfono**.

> «Cuando el agente escala, no manda un correo: le deja el hilo completo a una
> persona, que entra por el mismo chat. El deudor no nota el cambio de manos.»

### Acto 4 — el cierre · 30 s

Vuelve al anexo de compliance del acto 1.

> «Cada intento queda registrado, incluidos los que **no** salieron: si mañana la
> SIC pregunta por qué le escribieron a alguien un domingo, la respuesta no es una
> explicación, es un renglón que dice que no se le escribió y a qué hora del lunes
> salió en su lugar. Eso es lo que las casas de cobranza no tienen.»

---

## 4. Las preguntas que van a hacer

| Pregunta | Respuesta |
|---|---|
| ¿Y si dice algo que no está previsto? | Escala. No improvisa. Está en el prompt como prohibición y en el código como validación. |
| ¿Puede ofrecer descuentos por su cuenta? | No. Los rangos los fija el cliente por tramo de mora, y `proponerAcuerdo` rechaza lo que se salga. |
| ¿Dónde queda la plata? | En su pasarela, su cuenta. Nosotros solo generamos la referencia. |
| ¿Se puede conectar a nuestro sistema? | La cartera entra por Excel/CSV hoy. Un conector al ERP es trabajo de implementación, no de producto. |
| ¿Cuánto se demora montarlo? | Implementación 1:1: su WABA, su número, su pasarela, sus plantillas aprobadas por Meta. |

---

## 5. Si algo falla

| Falla | Qué hacer |
|---|---|
| El modelo va lento o da error | Ya cae solo a guionado. Si quieres forzarlo desde el arranque: `CEREBRO=guionado pnpm dev`. |
| Se acabó el crédito de la llave | Cambia de proveedor con `CEREBRO_PROVEEDOR`. El agente es el mismo: prompt, herramientas y validaciones no dependen de quién responda. |
| No confías en la conexión | Pon el video. Está grabado con el modelo real, no con el respaldo. |
| Chatwoot no responde | No pasa nada: el espejo es asíncrono, el teléfono nunca depende de él. Salta el acto 3. |
| No hay internet en la sala | Todo corre local menos el modelo. Con `CEREBRO=guionado` la demo entera funciona sin red. **Graba el video igual como respaldo.** |
| El agente dice algo raro en vivo | Reinicia y usa solo los botones del guion. No teclees libre delante del cliente. |

---

## 6. Qué es real y qué no

Vale la pena tenerlo claro por si preguntan.

**Real, con tests:** ingesta de Excel/CSV con cuarentena de filas malas, guard de
Ley 2300 (13 motivos, horarios, festivos, cupo semanal), planificador de cadencia
por tramo, envío y recepción por Meta Cloud API con verificación de firma,
construcción del link de Wompi y verificación del checksum de su webhook,
simulador de piloto con grupo de control.

**De la demo, no de producción:** la cartera es ficticia y vive en memoria del
proceso (`src/demo/estado.ts`), la pasarela es una página nuestra
(`/pagar/[referencia]`) en vez de Wompi, y el teléfono es una pantalla web en vez
de WhatsApp.

**Lo que falta para el primer cliente:** persistencia (hoy todo es memoria), el
scheduler que dispare la cadencia diaria, la ruta de ingesta con su UI, y la ruta
del webhook de la pasarela real. El código que va adentro de cada una ya existe;
falta el cableado.

---

## 7. El canal de voz

El agente llama por teléfono, negocia con las mismas seis herramientas y la
llamada queda en `/consola/llamadas` con transcripción, resumen, costo y lo que
ejecutó.

### Sin cuentas de nada

```bash
pnpm llamar "+573001234567"                       # guion determinista
pnpm llamar "+573001234567" --guion escala        # pide 12 cuotas
pnpm llamar "+573001234567" --personaje regatea   # dos modelos improvisando
```

Escribe filas reales, ejecuta las herramientas reales y produce un link de pago
con referencia válida. Lo único de mentira es que nadie pronunció las frases.
Exige `tenants.modo_demo` y la fila queda con `proveedor = 'simulado'`: una
llamada inventada no puede contar como evidencia ante la SIC.

**Los personajes son la prueba que vale.** Con `--personaje`, el deudor lo actúa
un modelo y cada corrida sale distinta: `negocia`, `regatea`, `no_es`,
`ya_pago`, `pide_baja`. Fueron esas corridas las que encontraron los dos bugs
más caros del canal —el agente quedándose mudo al agotar los pasos, y la baja
que nadie registraba—, que un guion fijo nunca habría mostrado.

### Con cuentas

```
VOZ=deepgram      DEEPGRAM_API_KEY=…   VOZ_VOZ=aura-2-…-es
TELEFONIA=twilio  TWILIO_ACCOUNT_SID=…  TWILIO_AUTH_TOKEN=…  TWILIO_NUMERO_VOZ=+1…
VOZ_URL_PUBLICA=https://….ngrok.app
```

Twilio en modo trial **solo llama a números verificados** y antepone un mensaje
grabado: verificá tu celular apenas abras la cuenta, no a las ocho de la mañana.

### Lo que cuesta, y por qué se cobra aparte

| Duración | Costo real |
|---|---|
| 1 min | COP 461 |
| 1,5 min | COP 772 |
| 2 min | COP 922 |

Un WhatsApp dentro de la ventana de servicio vale **cero** y una plantilla
`utility` COP 3,2. La voz cuesta unas 300 veces más, así que **no sale del cupo
de mensajes**: van 100 minutos incluidos y el excedente a COP 1.500/min. A 25
llamadas diarias, meterla en la mensualidad se comería el plan Pequeña entero.

Tres cosas de la factura que no están en ninguna tabla de tarifas:

1. **Twilio redondea al minuto hacia arriba.** Una llamada de 1:05 factura dos.
2. **La no contestada no se cobra, pero el buzón sí** — contesta, la llamada
   queda `completed` y se cobra entera. Por eso el puente cuelga si nadie habla
   en los primeros 8 s, en vez de pagar el AMD de Twilio y sus 2 s de latencia
   en **todas** las llamadas.
3. **Deepgram cobra socket abierto, no conversación.** Se abre en el evento
   `start` de Twilio, nunca al marcar: el timbrado no lo cobra Twilio pero sí
   lo cobraría Deepgram.

---

## 8. Conciliación

Dos modos en `/consola/conciliacion`.

**Entre portales** (`?modo=portales`) — consulta el portal contable y el del
banco por API, cruza contra el Excel que suba el asesor, y un agente explica
cada descuadre con su causa probable y ordena por plata. Los dos portales de
demostración devuelven formas distintas a propósito (`data` con campos en
inglés uno, `resultado.movimientos` con montos como texto el otro), que es lo
que hacen los portales de verdad.

**Dos archivos** (`?modo=archivos`) — el export contable contra el Excel, sin
depender de ninguna API.

```bash
# Archivos de muestra con descuadres plantados y explicables uno por uno
demo/contable.xlsx  demo/excel-operacion.xlsx    # modo archivos
demo/excel-portales.xlsx                          # modo portales
```

El cruce es **código, al centavo y sin modelo**: tolerancia cero, montos en
centavos enteros, y las referencias normalizadas para que `CR-00034` y `CR00034`
sean la misma. El agente solo explica y prioriza; ninguna cifra suya sale de
otro lado que no sean los archivos.

Con tres o más fuentes dice además **cuál se desvió**: si dos coinciden y una
no, la que no es la que hay que corregir. Con dos que difieren no acusa a
nadie, porque no hay a quién creerle.
