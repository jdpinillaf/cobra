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
pnpm build && PORT=3100 pnpm start     # producción: sin el indicador de dev
pnpm grabar                            # → video/*.mp4
```

Salen tres archivos: el recorrido completo, el checkout solo, y la rama de
escalamiento. El navegador corre sin cabeza, así que en el video no aparece
barra de direcciones, ni escritorio, ni ninguna otra ventana.

Ojo: hay que grabar contra `pnpm start`, no `pnpm dev`. El servidor de
desarrollo pinta un indicador flotante de Next en la esquina que se cuela en la
toma.

Para grabar se usa `/demo?limpio=1`, que oculta los botones del guion y deja
solo la barra de escritura. Con `/demo` a secas quedan los botones, que es lo
que sirve para presentar en vivo.

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
