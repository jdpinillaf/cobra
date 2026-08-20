# Ponos

Agente de cobranzas conversacional para Colombia. Ingiere la cartera del cliente, ejecuta una cadencia de contacto por WhatsApp/SMS que **cumple la Ley 2300 por construcción**, y genera links de pago con referencia única contra la pasarela del propio cliente.

El repo contiene dos cosas: el motor y la landing de venta que lo demuestra en vivo.

## Qué vende esto

No "mandamos mensajes". **Cartera recuperada sin exponerse a sanción de la SIC.** El log de envíos bloqueados con su motivo es el entregable de compliance; las casas de cobranza tradicionales no lo tienen porque violan la ley a diario.

## Correr

Requiere Node 22 (ver `.nvmrc`).

```bash
nvm use
pnpm install
pnpm test          # 354 tests
pnpm typecheck
pnpm dev           # la landing en localhost:3000
pnpm demo -- --deudores 500 --dias 90
```

`pnpm demo` corre un piloto simulado por consola: cartera ficticia, cadencia con reloj acelerado, grupo de control, y el anexo de compliance. La landing corre exactamente lo mismo en el navegador — si las cifras difieren, algo se rompió.

## Cómo está organizado

| Ruta | Qué hace |
|---|---|
| `src/domain/types.ts` | Modelo canónico: deudor, obligación, contacto, acuerdo, pago |
| `src/domain/planes.ts` | Planes comerciales, cupos y liquidación mensual |
| `src/compliance/guard.ts` | **El archivo que sostiene el producto.** Decide si un envío puede salir |
| `src/compliance/festivos.ts` | Festivos de Colombia (Ley Emiliani + móviles de Pascua) |
| `src/compliance/reloj-bogota.ts` | Todo se evalúa en hora de Bogotá, nunca en la del servidor |
| `src/cadence/planificador.ts` | Qué paso toca y cuándo puede salir legalmente |
| `src/ingest/` | Excel/CSV → esquema canónico, con cuarentena de filas malas |
| `src/channels/meta-cloud.ts` | WhatsApp por Meta Cloud API, directo, sin revendedor |
| `src/channels/meta-webhook.ts` | Firma del webhook, estados de entrega y mensajes entrantes |
| `src/channels/ventana-servicio.ts` | Ventana de 24 h: dónde los mensajes son gratis |
| `src/channels/opt-out.ts` | Detecta la baja pedida por el deudor y revoca el consentimiento |
| `src/channels/twilio.ts` | Solo SMS. Meta no lo vende y Colombia exige short code |
| `src/payments/wompi.ts` | Link de pago con referencia, firma de integridad y webhook |
| `src/demo/` | Cartera ficticia y simulador del piloto |
| `src/components/landing/` | La landing. El simulador corre el motor real en el navegador |
| `docs/modelo-de-negocio.md` | Segmento, pricing, unit economics y riesgos |

## Las reglas que van en el motor

**Ley 2300 de 2023** ([norma](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=213990)):

- Máx **1 contacto por semana** por deudor, **contando todos los canales juntos**. Máx 1 por día.
- L-V 7:00–19:00, sáb 8:00–15:00. Domingos y festivos prohibido.
- El deudor puede fijar canal, día y hora. Su preferencia **estrecha** la ventana legal, nunca la amplía.
- Prohibido contactar referencias o terceros.

La ventana semanal se evalúa en **valor absoluto**: un mensaje ya agendado a futuro también consume cupo. Sin eso, un envío diferido a mañana no contaría y el deudor recibiría dos mensajes seguidos.

## Decisiones que conviene no revisitar sin leer el porqué

- **El dinero nunca pasa por nosotros.** La cuenta de Wompi es del cliente. Recaudar y girar sería actividad de agregador, con exposición ante la SFC y SARLAFT.
- **Checkout Web, no API de Payment Links.** El Checkout acepta *nuestra* referencia; el Payment Link deja que Wompi genere la suya, y sin referencia propia no hay atribución.
- **El SMS nunca sale del cupo del plan.** Cuesta COP 210 contra COP 3,2 de una plantilla `utility`; a COP 45 de overage se perdería plata en cada uno.
- **"Mensaje" cuenta entrantes y salientes.** Con Meta directo eso ya no recupera costo —el tráfico conversacional es gratis— sino que acota el uso del agente. Es una decisión comercial, y está anotada como tal en `planes.ts`.
- **Un intento bloqueado no consume cupo semanal.** Si lo consumiera, un bloqueo por horario impediría reintentar durante siete días.
- **WhatsApp va por Meta Cloud API directo, no por un revendedor.** Un BSP cobra USD 0.005 por mensaje encima de la tarifa de Meta, **entrante y saliente**, incluidos los de la ventana de servicio de 24 h que Meta regala. En un agente conversacional esa ventana es el grueso del tráfico, así que la comisión se paga sobre todo por lo que no cuesta: la plantilla baja de COP 24 a COP 3,2 y la conversación de COP 20 a cero.
- **Twilio se queda solo para el SMS.** Meta no vende SMS y Colombia exige short code. `ChannelProvider` sigue existiendo por eso: los dos canales van por proveedores distintos y el motor de cadencia no tiene por qué enterarse.
- **La ventana de 24 h se modela aparte del guard.** La Ley 2300 dice *cuándo* se puede contactar; la ventana dice *qué formato* acepta Meta. Un mensaje puede caer dentro de la ventana y seguir siendo ilegal por ser domingo. El guard se evalúa primero y manda.
- **`cancelar` no es un opt-out.** En Colombia significa *pagar*. Tratarla como baja apagaría la cadencia justo del deudor que está pagando.

## La landing

Vive en `/` y su pieza central es el simulador, que importa `generarCartera` y `simular` y los corre **en el navegador del visitante**. No hay backend, ni cifras precalculadas, ni maqueta.

Dos cosas medidas que conviene no re-litigar:

- **No uses un Web Worker.** Se intentó. Turbopack emite el archivo del worker como `.ts` crudo en `/static/media/` al compilar para producción y el navegador no lo puede ejecutar. Con el tope de 5.000 deudores el peor caso son ~1,5 s sobre un botón que el visitante presionó a propósito.
- **El cómputo se difiere, el código no.** El `dynamic()` sobre el simulador no lo saca de la carga inicial: Turbopack precarga el chunk igual. Son 36 KB sobre 583 KB y no vale la pena pelearlo. Lo que sí se difiere de verdad es la simulación, que no arranca hasta que su sección entra en pantalla. Zod nunca entra al bundle porque el motor lo importa solo con `import type`.

Configuración: `NEXT_PUBLIC_CALENDLY_URL` activa el embed de agendamiento. Sin esa variable la sección muestra el correo, que es mejor que un iframe vacío.

## Configuración del canal

Nada de esto puede salir al navegador. Sin las variables, el webhook responde 503 y la factory cae a `ProveedorSimulado`: hay que pedir explícitamente hablar con la red.

| Variable | Para qué |
|---|---|
| `PROVEEDOR_WHATSAPP=meta` | Activa el envío real. Sin ella, simulado |
| `META_PHONE_NUMBER_ID` | Id del número dentro del WABA del cliente. No es el teléfono |
| `META_WABA_ID` | WhatsApp Business Account del cliente |
| `META_ACCESS_TOKEN` | System User permanente del Business Manager **del cliente** |
| `META_APP_SECRET` | Firma `X-Hub-Signature-256` de los webhooks |
| `META_TOKEN_VERIFICACION` | Handshake `GET` de suscripción |
| `PROVEEDOR_SMS=twilio` | Activa el fallback real de SMS |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_SHORT_CODE` | SMS. El remitente tiene que ser short code, no un celular |

Con implementaciones 1:1 **no hace falta ser Tech Provider ni montar Embedded Signup**: basta un System User sobre la WABA del propio cliente. El programa de partners solo aplica a onboarding self-serve a escala.

## Demo de venta

`pnpm dev` → `/demo`. Un simulador de WhatsApp al lado del expediente que el
agente consulta en vivo: saldo, mora, consentimiento, límites de negociación y
la decisión del guard. Termina en un link de pago que concilia contra la
obligación por la referencia `COB-…`.

El runbook de la reunión —variables de entorno, montaje de Chatwoot, guion y
qué hacer si algo falla— está en [`docs/demo-para-reunion.md`](docs/demo-para-reunion.md).
El flujo explicado para un cliente, en [`docs/flujo-agente-cobranza.md`](docs/flujo-agente-cobranza.md).

Sin `ANTHROPIC_API_KEY`, o si el modelo falla, el agente cae solo a respuestas
guionadas (`src/agent/guionado.ts`) que ejecutan las **mismas** validaciones. Se
nota en el panel, no en el teléfono.

## Estado

Listo y verificado: modelo de dominio, compliance, cadencia, ingesta, canal saliente y entrante, ventana de servicio, opt-out, pagos, simulador del piloto, la landing y la demo conversacional.

Pendiente:

- **Aprobación humana caso a caso.** Hoy `proponerAcuerdo` (`src/agent/herramientas.ts`) aprueba lo que cabe en los rangos que el cliente autorizó por escrito, y escala el resto. El modelo de dominio contempla `esperando_aprobacion`, pero no hay panel donde alguien apruebe.
- Panel de operación para el cliente. Chatwoot (`src/integrations/chatwoot.ts`) cubre la consola de conversaciones, no la de cartera.
- **Persistencia real detrás de `RepositorioWebhook`.** Hoy el webhook usa `RepositorioEnMemoria`, que se pierde al reiniciar y no se comparte entre instancias. Con dos réplicas y Meta reintentando, un entrante se registraría dos veces y el cupo quedaría mal contado. Es lo primero que hay que cerrar antes del primer cliente.
