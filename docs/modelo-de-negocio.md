# Modelo de negocio — Ponos

> Aprobado 2026-08-10. Este documento sostiene la copia de la landing y las decisiones de producto. Si algo aquí cambia, la landing y `src/domain/planes.ts` cambian con él.

## Qué vendemos

No "software de mensajería". **Cartera recuperada sin exponerse a sanción de la SIC.**

Las casas de cobranza tradicionales violan la Ley 2300 a diario: contactan de noche, contactan domingos, llaman tres veces por semana, hostigan a las referencias. El motor de cadencia con compliance embebido es lo que ellas no tienen y no pueden improvisar.

Implementación 1:1, no SaaS self-serve. Cada cliente tiene su WABA, su número y su pasarela.

## Cliente ancla

Casas de préstamo y microcrédito **legalmente constituidas** que no son entidades vigiladas por la SuperFinanciera: su supervisor en cobranza es la SIC. Empresa formal, con cámara de comercio, contratos y pagaré — lo que cambia frente a un banco es quién las supervisa, no su legalidad.

Es justamente ese perfil el que compra: tienen la obligación legal de cumplir la Ley 2300 y hoy no tienen con qué demostrarlo. Cartera grande y sucia, bases en Excel, dolor alto, decisión rápida.

Cubrimos las cuatro etapas: preventiva, temprana (1-30), media (31-90) y castigada (+90).

## Ingresos

### Implementación y suscripción

| Tier | Deudores | Msgs WhatsApp incl. | Setup | Mensualidad |
|---|---|---|---|---|
| Pequeña | ≤ 500 | 3.000 | COP 1.500.000 | COP 400.000 |
| Mediana | ≤ 2.000 | 12.000 | COP 3.500.000 | COP 800.000 |
| Grande | 2.001–3.000 | 18.000 | COP 8.000.000 | COP 1.200.000 |
| Corporativo | > 3.000 | cotizado | COP 8.000.000+ | COP 1.200.000 + COP 400/deudor |

- Overage WhatsApp: **COP 45.000 / 1.000 mensajes**
- SMS: add-on prepago a **COP 280/msg**, nunca dentro del cupo
- Add-on cartera castigada: **COP 300.000/mes**

### Las tres reglas que impiden que el modelo se rompa

1. **"Mensaje" cuenta entrantes y salientes.** La regla nació cuando el canal iba por un revendedor que cobraba ambos. Con Meta Cloud API directo el tráfico conversacional es **gratis**, así que el conteo dejó de recuperar costo y pasa a ser margen y a acotar el uso del agente. Se mantiene a propósito: da colchón para cambiar de proveedor sin re-precificar, y simplifica la factura del cliente. Es una decisión comercial, no un traslado de costo, y conviene no confundirlas al negociar.
2. **Todos los tiers tienen techo de deudores.** El listado original tenía un tier "+2.000" a precio plano sin tope: con 10.000 deudores costaba ~COP 1,5M contra COP 1,2M de ingreso. Un solo cliente grande quebraba el tier.
3. **El SMS nunca sale del cupo.** Cuesta COP 210 y el overage se cobra a COP 45. Cada SMS dentro del cupo perdería COP 165.

### Fase 2 — success fee

1% sobre cartera recuperada del mes, o 3% sobre recaudo atribuido (pago hecho con la referencia que generó el agente dentro de 7 días del contacto), con tope de 2x la mensualidad.

Recomendación: cobrarlo **solo sobre mora >30 días**. En preventiva el deudor iba a pagar igual y cobrar ahí no se sostiene en la negociación.

**Sin definir:** si el 1% aplica a todo lo recuperado o solo a lo atribuible, y si el fee reemplaza o se suma a la mensualidad.

## Unit economics

A COP 4.000/USD, con **Meta Cloud API directo** (rate card de Colombia vigente desde el 1 de abril de 2026):

| Ítem | Meta directo | Vía revendedor (antes) |
|---|---|---|
| WhatsApp plantilla `utility` | $0.0008 = **COP 3,2** | $0.001 + $0.005 = COP 24 |
| WhatsApp plantilla `authentication` | $0.0008 = **COP 3,2** | COP 24 |
| WhatsApp en conversación (in/out) | **COP 0** | ~COP 20 |
| WhatsApp `marketing` (promos) | ~$0.02 = **COP 80** | ~COP 100 |
| **SMS Colombia** (sigue en Twilio) | $0.0525 = **COP 210** | COP 210 |
| LLM por conversación (triage + negociación) | ~COP 80 | ~COP 80 |

**Costo por deudor gestionado/mes ≈ COP 85**, del cual el LLM es ahora la mayor parte. Antes eran ~COP 150. Margen bruto de mensajería por tier: pasa de ~64% a ~95%.

Colombia es de los mercados más baratos del mundo para `utility` y `authentication`. La tarifa la fija el **indicativo del destinatario**, no el país del negocio.

### Por qué directo y no por un revendedor

Un BSP cobra USD 0.005 por mensaje encima de la tarifa de Meta, **entrante y saliente**. Lo decisivo no es el 7x de la plantilla: desde el 1 de noviembre de 2024 Meta no cobra los mensajes de la ventana de servicio de 24 h, sin tope. En un agente conversacional esa ventana es el grueso del tráfico, así que la comisión del revendedor se paga sobre todo por lo que en Meta vale cero.

Lo que se compraba con esa comisión —onboarding del WABA como BSP— casi no aplica a este negocio: con implementaciones 1:1 basta un System User token sobre la WABA del propio cliente. El programa de Tech Provider y Embedded Signup solo hace falta para onboarding self-serve a escala.

Twilio se queda **solo para el SMS**: Meta no lo vende y Colombia exige short code. La arquitectura es multi-proveedor, no un swap.

## Arquitectura comercial

- **1 WABA + 1 número por cliente.** Su marca, su riesgo, él es Responsable del dato. Un ban de Meta no contagia a los demás clientes.
- **Su cuenta de Wompi / ePayco / Bold.** La plata nunca pasa por nosotros. Recaudar y girar sería actividad de agregador, con exposición ante la SFC y SARLAFT.
- Contrato 12 meses, setup no reembolsable, salida a 60 días tras el piloto.
- **Piloto pagado de 6 semanas con grupo de control:** 500 deudores de 1-30 días tratados por el agente contra 500 con el proceso actual del cliente. El uplift medido es el argumento de renovación y lo que justifica el success fee más adelante.

## Restricciones legales

### Ley 2300 de 2023

[Norma completa](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=213990). Vigente desde el 10 de octubre de 2023.

- Máx **1 contacto por semana** por deudor, **contando todos los canales juntos**. Máx 1 por día.
- L-V 7:00–19:00, sáb 8:00–15:00. Domingos y festivos prohibido.
- El deudor puede fijar canal, día y hora. Su preferencia **estrecha** la ventana legal, nunca la amplía.
- Prohibido contactar referencias o terceros. Solo deudor, codeudor o deudor solidario.
- Comunicación respetuosa, sin intimidación ni presión psicológica.
- Sanciona la SIC; la SuperFinanciera para entidades vigiladas.

### Habeas Data (Leyes 1581/2012 y 1266/2008)

El cliente es Responsable del tratamiento, nosotros Encargados. Hace falta contrato de encargo. El registro en RNBD lo hace el cliente.

### Meta / WhatsApp

Exige opt-in. El pagaré sirve como base de autorización, pero no protege del quality rating: si los deudores reportan, Meta tumba el número. Un recordatorio de pago es plantilla `utility` mientras no lleve lenguaje promocional; si mete descuento u oferta, Meta la reclasifica a `marketing` y cuesta **25x** (COP 80 contra COP 3,2). Con las tarifas directas la brecha entre categorías es mucho más ancha que antes: una sola plantilla mal clasificada duplica la factura del mes. Por eso `Plantilla.categoria` se declara y se audita en el código.

### SMS Colombia

El sender alfanumérico se sobrescribe con un short code local y los números largos virtuales están prohibidos, así que el SMS exige short code. Contenido comercial solo 8:00–21:00.

## Riesgos

1. **Opt-in.** Es el riesgo número uno. Si los deudores reportan como spam, Meta baja el quality rating y tumba el número. Mitigación: arrancar solo con mora temprana, plantillas conservadoras, y corte automático al detectar caída del rating.
2. **El agente prometiendo algo indebido.** Mitigación: aprobación humana obligatoria de todo acuerdo, rangos pre-aprobados por cliente, y logs inmutables.
3. **Ban de WABA.** Mitigación: un número por cliente, nunca compartido.

## Mercados descartados

**Estados Unidos.** No es un mercado adyacente, es un campo minado. La cobranza por SMS cae bajo TCPA (daños de USD 500–1.500 **por mensaje**, con demandas colectivas) y Regulation F (consentimiento, opt-out visible, límite 7-en-7). Exige registro 10DLC, donde las campañas de cobranza reciben el escrutinio más duro. Y WhatsApp casi no se usa allá, así que el canal barato no existe.

Pricing hipotético, no vendido: Small ≤500 $400/$150 · Medium ≤2.000 $900/$300 · Enterprise +2.000 $2.000/$500 · lost portfolio $100/mes · overage $15/1.000. Ese overage está **por debajo** del costo real ($0.009–0.011/msg).
