# Estado del producto — 24 de agosto de 2026

> Foto del repo, no del plan. Lo que dice acá se verificó corriendo el código:
> `pnpm test`, `pnpm typecheck`, `pnpm test:e2e`, y grep sobre qué tabla tiene
> código que la toque y cuál no. Si un módulo está escrito pero nadie lo llama,
> acá aparece como "escrito, sin conectar" y no como "listo".

---

## 0. Resumen

`cobra` es el motor de **dos productos sobre un mismo esquema**: cobranza y
conciliación.

| | Cobranza | Conciliación |
|---|---|---|
| Estado | **Construido y verificado.** Corre sobre Postgres real, con RLS por tenant, consola, agente y cron | **Solo esquema y especificación.** Cero motor |
| Evidencia | 950 tests verdes, `typecheck` limpio, 11 migraciones aplicadas, consola con tres pantallas vivas | 5 tests E2E que fallan con `no implementado: crearSistema` |
| Cliente | Ninguno todavía | Dos cerrados, ambos con Bancolombia |

La inversión de las últimas dos semanas es esa tabla. **El producto que está
construido no tiene cliente; el producto que tiene dos clientes cerrados no está
construido.** Todo lo que sigue es el detalle de por qué, y qué falta para
cerrar la brecha.

### Números

| Medida | Valor |
|---|---|
| Código (sin tests) | 17.262 líneas TS/TSX |
| Tests | 9.582 líneas · **950 tests en 48 archivos** · 12,6 s |
| Migraciones | 11 archivos · 974 líneas SQL |
| Scripts de operación | 8 comandos · 1.204 líneas |
| Commits | 47 · último el 20 de agosto |
| `pnpm typecheck` | limpio |
| `pnpm lint` | limpio · quedan dos avisos de variables sin usar en la especificación E2E, que desaparecen cuando se implemente |
| `pnpm test:e2e` | **5 de 5 fallan** — es la especificación de conciliación, sin implementar |
| PR abierto | `conciliacion-v1` → `main`, 46 commits, fast-forward limpio |

Requiere **Node 22** (`.nvmrc`). Con Node 20 vitest ni arranca.

---

## 1. Mapa de lo que existe hoy

```mermaid
flowchart TB
  subgraph ENTRA["Entradas"]
    WA["📩 Webhook WhatsApp<br/>/api/whatsapp/webhook"]
    CRON["⏰ Vercel Cron<br/>/api/cron/tick"]
    CONS["👤 Consola<br/>asesor escribe"]
    SEED["🌱 pnpm sembrar<br/>cartera de demo"]
    MAIL["📧 Correo del banco"]
    COMPR["🧾 Comprobante por WhatsApp"]
  end

  subgraph MOTOR["Motor"]
    PROC["procesarWebhook<br/>idempotencia · estados · opt-out · número errado"]
    GUARD["🔒 guard.ts — Ley 2300<br/>13 motivos de bloqueo"]
    COMP["compuerta.ts<br/>¿puede el agente responder?"]
    CEREBRO["🧠 cerebro.ts<br/>LLM + 6 herramientas"]
    CAD["planificador + motor<br/>cadencia por tramo"]
    RECON["motor de conciliación"]
    OCR["OCR de comprobantes"]
    PARSER["parser Bancolombia"]
  end

  subgraph SALE["Salidas"]
    META["ProveedorMetaCloud<br/>WhatsApp"]
    TW["ProveedorTwilioSms"]
    LINK["💳 Link de pago<br/>referencia COB-…"]
    CHAT["Chatwoot — espejo"]
    SHEET["Google Sheets"]
  end

  subgraph DATOS["Postgres · Supabase · RLS por tenant"]
    DB[("tenants · deudores · obligaciones<br/>contactos · conversaciones · acuerdos<br/>pagos · agent_events")]
    DB2[("raw_emails · bank_notifications<br/>payment_claims · reconciliations<br/>cases · approvals · jobs")]
  end

  WA --> PROC --> COMP --> CEREBRO --> META
  CRON --> CAD --> GUARD --> META
  GUARD --> TW
  CEREBRO --> LINK
  CONS --> META
  SEED --> DB
  PROC --> DB
  CAD --> DB
  CEREBRO --> DB
  CONS -.-> CHAT

  MAIL -.-> PARSER -.-> RECON
  COMPR -.-> OCR -.-> RECON
  RECON -.-> DB2
  RECON -.-> SHEET

  classDef listo fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef falta fill:#fef2f2,stroke:#dc2626,color:#7f1d1d,stroke-dasharray:4 3
  classDef parcial fill:#fef9c3,stroke:#ca8a04,color:#713f12

  class WA,CRON,CONS,SEED,PROC,GUARD,COMP,CEREBRO,CAD,META,CHAT,DB listo
  class MAIL,COMPR,RECON,OCR,PARSER,SHEET,DB2 falta
  class TW,LINK parcial
```

**Verde**: escrito, probado y conectado.
**Amarillo**: escrito y probado, **no conectado a producción**.
**Rojo punteado**: no existe todavía.

---

## 2. Camino entrante — el que ya funciona

Es el flujo más maduro del repo. Un mensaje del deudor entra, el agente arma el
expediente, la compuerta decide si puede hablar, el modelo piensa y la respuesta
sale. Cada paso deja rastro.

```mermaid
sequenceDiagram
  autonumber
  participant M as Meta Cloud API
  participant R as route.ts
  participant P as procesarWebhook
  participant DB as Postgres
  participant A as responderEntrante
  participant C as cerebro · LLM
  participant PR as ProveedorMetaCloud

  M->>R: POST · cuerpo crudo + X-Hub-Signature-256
  R->>R: verificarFirmaMeta · HMAC timingSafeEqual
  Note over R: Firma mala → 401.<br/>Sin ella cualquiera inyecta un "BAJA" falso

  R->>DB: SELECT tenants WHERE phone_number_id = ?
  Note over R,DB: Meta mezcla varias empresas en una entrega.<br/>El payload se parte por número ANTES de tocar nada

  R->>P: conTenant → transacción con RLS
  P->>DB: idempotencia · wamid ya visto
  P->>DB: registra entrante · abre ventana 24 h
  P->>DB: opt-out · número errado
  Note over P,DB: El mensaje que pide la baja se guarda igual.<br/>Es la prueba de que se pidió

  R-->>M: 200 OK
  Note over R,M: El 200 sale ANTES de pensar.<br/>Meta degrada la cuenta si el 200 tarda

  R->>A: after · fuera de la transacción
  A->>DB: expediente · saldo, mora, hilo, consentimiento
  A->>A: compuerta.evaluarRespuesta

  alt Prohibición absoluta — baja, número errado, sin consentimiento, obligación cerrada
    A->>DB: Contacto bloqueado + motivo
    Note over A,DB: Evidencia ante la SIC. No sale nada
  else Asesor tomó el hilo
    A->>A: silencio · no escribe contacto
    Note over A: Es decisión operativa, no legal.<br/>No puede ensuciar el reporte de cumplimiento
  else Adelante
    A->>C: prompt + hilo + límites del tramo
    C->>DB: consultarCartera · consultarPoliticas
    C->>DB: proponerAcuerdo · generarLinkDePago
    C->>DB: anotarConsumoIa · tokens y latencia
    C-->>A: texto
    A->>PR: enviar
    A->>DB: Contacto saliente · costo · categoría
  end
```

**Las tres cosas que hacen que esto no sea un chatbot** — y que ya están en el código:

1. **El expediente entra por herramientas, no por el prompt.** El modelo tiene
   que *pedir* la cartera, y esa consulta queda anotada. Es lo que se muestra en
   la demo.
2. **Un domingo el agente sí contesta.** La Ley 2300 limita cuándo la empresa
   *contacta*, no si puede *responder*. Lo que no levanta ningún entrante son
   las cuatro prohibiciones absolutas.
3. **Si el modelo falla, `guionado.ts` ejecuta las mismas validaciones.** Un
   acuerdo fuera de rango se rechaza igual y el link que manda existe de verdad.

---

## 3. Camino saliente — el motor de cobro

```mermaid
flowchart TD
  T["⏰ Cron · hoy 1x/día, debería ser cada 15 min"]
  T --> TEN["Por cada tenant activo con capacidad 'cobranza'"]
  TEN --> CT["conTenant · RLS activa"]
  CT --> PEND["pasosPendientes · cadencia del tramo"]
  PEND --> LOCK{"marcarPasoEjecutado<br/>UNIQUE gana la carrera"}
  LOCK -- "otro proceso lo tomó" --> OMIT["omitido · no gasta nada"]
  LOCK -- "es mío" --> G{"🔒 guard.ts<br/>Ley 2300"}

  G -- "opt-out · referencia · sin consentimiento<br/>obligación cerrada · acuerdo vigente" --> DET["detenido<br/>escribe Contacto bloqueado"]
  G -- "domingo · festivo · fuera de horario<br/>límite diario · límite semanal" --> REP["reprogramado<br/>escribe Contacto bloqueado<br/>+ próximo instante legal"]
  G -- "permitido" --> ENV["envía por WhatsApp o SMS<br/>escribe Contacto enviado + costo"]

  DET --> EV[("agent_events")]
  REP --> EV
  ENV --> EV

  classDef ok fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef warn fill:#fef9c3,stroke:#ca8a04,color:#713f12
  class ENV,EV ok
  class T warn
```

**Las tres ramas escriben un `Contacto`, incluida la que no envía.** No es
simetría por prolijidad: ante un reclamo ante la SIC lo que prueba que la
empresa cumplió no es el mensaje que salió, es el que **no** salió y por qué.

Los 13 motivos de bloqueo del guard:

`destinatario_es_referencia` · `opt_out` · `numero_no_corresponde` ·
`sin_consentimiento` · `obligacion_cerrada` · `acuerdo_vigente` · `domingo` ·
`festivo` · `fuera_de_horario_legal` · `canal_distinto_al_preferido` ·
`fuera_de_horario_preferido` · `dia_distinto_al_preferido` · `limite_diario` ·
`limite_semanal`

---

## 4. El esquema, por capacidad

Un comerciante es `tenants` + `capacidades text[]`. Activarle el segundo
producto es un `INSERT`, no una migración. Esa decisión es la que permite que
conciliación entre como cuña y cobranza sea la expansión sobre el mismo cliente.

```mermaid
erDiagram
  tenants ||--o{ tenant_usuarios : "acceso a la consola"
  tenants ||--o| tenant_cobranza : "capacidad cobranza"
  tenants ||--o{ tenant_email_senders : "capacidad conciliación"

  tenants ||--o{ deudores : ""
  deudores ||--o{ obligaciones : ""
  deudores ||--o{ conversaciones : "una abierta a la vez"
  obligaciones ||--o{ contactos : "todo intento, salga o no"
  obligaciones ||--o{ acuerdos : ""
  obligaciones ||--o{ pagos : "referencia COB-…"
  conversaciones ||--o{ notas : ""
  conversaciones ||--o{ contactos : ""

  tenants ||--o{ raw_emails : ""
  raw_emails ||--o{ bank_notifications : "parser"
  tenants ||--o{ payment_claims : "comprobante + OCR"
  bank_notifications ||--o| reconciliations : "cruce determinístico"
  payment_claims ||--o| reconciliations : ""
  reconciliations ||--|| cases : ""
  cases ||--o{ approvals : ""

  tenants ||--o{ agent_events : "append-only · la tabla que sostiene el producto"
```

**Estado real tabla por tabla:**

| Grupo | Tablas | Código que las toca |
|---|---|---|
| Núcleo cobranza | `tenants`, `tenant_cobranza`, `tenant_usuarios`, `deudores`, `obligaciones`, `conversaciones`, `contactos`, `acuerdos`, `pagos`, `cadencias`, `plantillas`, `ventanas_servicio`, `webhook_procesados`, `sesiones`, `notas`, `etiquetas`, `lecturas` | ✅ repositorios, consola, motor |
| Auditoría | `agent_events` | ✅ agente, consumo, `pnpm auditoria` |
| Ingesta de cartera | `cargas`, `filas_cuarentena`, `conectores` | ⚠️ **ninguno.** El esquema existe; `src/ingest` son funciones puras que nadie llama desde la app |
| Operación | `avisos_cupo`, `notificaciones` | ⚠️ ninguno |
| Conciliación | `raw_emails`, `bank_notifications`, `payment_claims`, `reconciliations`, `cases`, `approvals`, `jobs`, `tenant_email_senders` | ❌ solo `raw_emails` tiene repositorio. Las otras siete: cero referencias en `src/` |

---

## 5. Conciliación: qué hay y qué falta

Es el producto que se decidió vender primero, y hoy es lo menos construido del
repo. Lo que existe son los **cimientos** y la **especificación**.

```mermaid
flowchart LR
  subgraph HAY["Lo que ya está"]
    ESQ["Esquema completo<br/>8 tablas + RLS"]
    E2E["5 caminos E2E<br/>escritos como especificación"]
    RAW["repo de raw_emails<br/>+ test de aislamiento cruzado"]
    CHAN["src/channels<br/>Meta Cloud, HMAC, entrantes, ventana 24 h"]
    RELOJ["reloj-bogota<br/>+ festivos colombianos"]
    CENT["Montos en centavos enteros"]
  end

  subgraph FALTA["Lo que falta — todo el motor"]
    DKIM["🚨 Prueba día 0:<br/>¿sobrevive DKIM al reenvío de Gmail?"]
    WORKER["Cloudflare Email Worker<br/>+ validación de alias"]
    PARSE["Parser Bancolombia<br/>2 plantillas · corpus real"]
    MEDIA["Media de WhatsApp<br/>descarga síncrona, URL vence a los 5 min"]
    OCRM["OCR con schema zod<br/>+ 30 capturas de eval"]
    MATCH["Motor determinístico<br/>monto · ventana · nombre · últimos 4"]
    JOBS["Tabla jobs + waitUntil<br/>+ cron de respaldo"]
    SHEETS["Google Sheets del cliente"]
    HEART["Heartbeat de ingesta<br/>48 h sin correo = alerta"]
  end

  DKIM ==> WORKER ==> PARSE ==> MATCH
  MEDIA ==> OCRM ==> MATCH
  MATCH ==> JOBS
  MATCH ==> SHEETS
  MATCH ==> HEART

  classDef listo fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef falta fill:#fef2f2,stroke:#dc2626,color:#7f1d1d
  classDef bloq fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-width:3px

  class ESQ,E2E,RAW,CHAN,RELOJ,CENT listo
  class WORKER,PARSE,MEDIA,OCRM,MATCH,JOBS,SHEETS,HEART falta
  class DKIM bloq
```

Los cinco E2E que hoy fallan **son el contrato del producto**, no deuda:

1. Concilia cuando el comprobante llega primero y el aviso del banco cuatro minutos después
2. Concilia cuando el aviso llega primero y el comprobante dos horas después
3. **Nunca confirma un comprobante que no tiene aviso del banco detrás**
4. No concilia dos veces el mismo pago aunque el comprobante se reenvíe
5. Manda a cuarentena un correo firmado por otro dominio y jamás lo usa para confirmar

**Bloqueante de día 0, sin resolver:** verificar que la firma DKIM de
Bancolombia sobreviva al reenvío de Gmail. Treinta minutos de trabajo. Si no
sobrevive, la ingesta se va a IMAP y **cambia el diseño entero**. Escribir el
parser antes de esa prueba es apostar la semana 1.

---

## 6. Los huecos de cobranza — lo que impide encenderlo con un cliente

Ordenados por lo que costaría descubrirlos tarde.

```mermaid
flowchart TD
  A["🔴 Un solo número remitente para todos los tenants"]
  A --> A1["El webhook resuelve el tenant por phone_number_id,<br/>pero crearProveedores arma el remitente con META_PHONE_NUMBER_ID del entorno.<br/>Con dos clientes vivos, al deudor del segundo le contesta el número del primero.<br/><b>Arreglo: credenciales por tenant, no una línea</b>"]

  B["🔴 El circuito del pago no se cierra"]
  B --> B1["wompi.ts tiene checkout, checksum e interpretación de eventos, con tests.<br/>Pero no hay ruta /api/wompi/webhook y el link del agente apunta<br/>a nuestra propia página /pagar. Nadie concilia un pago real todavía"]

  C["🟠 La cartera solo entra por pnpm sembrar"]
  C --> C1["src/ingest mapea y normaliza Excel/CSV con tests,<br/>pero nadie lo llama: sin pantalla de carga, sin escribir en cargas<br/>ni en filas_cuarentena. Un cliente real no tiene cómo subir su cartera"]

  D["🟠 RLS no aplica en el camino del agente"]
  D --> D1["El turno corre en after, fuera de conTenant — a propósito,<br/>para no vaciar el pool esperando al modelo.<br/>El aislamiento depende del WHERE tenant_id de cada consulta.<br/>Revisado a mano; nada lo verifica solo mañana"]

  E["🟠 El cron es diario"]
  E --> E1["Vercel Hobby permite uno por día.<br/>Un paso que queda fuera de ventana a las 8:05 espera hasta mañana.<br/>Producción real necesita Pro y */15 * * * *"]

  F["🟡 Sin panel de aprobación"]
  F --> F1["La tabla approvals existe y el dominio contempla esperando_aprobacion,<br/>pero no hay pantalla. Hoy proponerAcuerdo aprueba lo que cabe en rango<br/>y escala el resto"]

  G["🟡 Sin backups"]
  G --> G1["Supabase free no tiene PITR.<br/>agent_events es append-only justamente porque es la evidencia"]

  H["🟡 Pestaña Cumplimiento apagada"]
  H --> H1["Es el entregable que sostiene la venta:<br/>el log de envíos bloqueados con su motivo.<br/>Los datos están en contactos; falta la pantalla"]

  classDef alto fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  classDef medio fill:#fef9c3,stroke:#ca8a04,color:#713f12
  classDef bajo fill:#f1f5f9,stroke:#64748b,color:#334155
  class A,B alto
  class C,D,E medio
  class F,G,H bajo
  class A1,B1,C1,D1,E1,F1,G1,H1 bajo
```

Más chico, pero real:

- ~~1 error de lint~~ y ~~el README desactualizado~~ se arreglaron junto con
  este documento. El lint escondía un bug de la pantalla: la ventana de 24 h se
  vencía con el asesor mirándola y el redactor seguía ofreciendo texto libre.
- **El motor está apagado a propósito.** Sin `PROVEEDOR_WHATSAPP=meta` todo cae
  a `ProveedorSimulado`: escribe la fila y no llama a nadie. Es la decisión
  correcta mientras el código lo revisó una sola persona.

---

## 7. Hacia dónde vamos

```mermaid
flowchart LR
  subgraph AHORA["Ahora · 24-31 ago"]
    P1["Mergear el PR<br/>conciliacion-v1 → main"]
    P0["🚨 Prueba DKIM día 0"]
    P2["Corpus de correos<br/>empieza a acumularse"]
    P3["30 capturas + extracto<br/>pedidos al cliente"]
    P4["Constitución de la SAS"]
  end

  subgraph S1["Semana 1 · ingesta"]
    I1["Email Worker + alias<br/>→ raw_emails"]
    I2["Tabla jobs + cron"]
  end

  subgraph S2["Semana 2 · lectura"]
    L1["Parser Bancolombia<br/>contra corpus real"]
    L2["Media de WhatsApp<br/>en src/channels"]
    L3["OCR + set de eval"]
  end

  subgraph S3["Semana 3 · cruce"]
    C1["Motor determinístico<br/>los 5 E2E en verde"]
    C2["Reintentos + backoff"]
    C3["Heartbeat de ingesta"]
  end

  subgraph S4["Semana 4 · salida"]
    O1["Consola: casos y traza"]
    O2["Sheets automático"]
    O3["Comando de provisión"]
  end

  subgraph DESP["Después · la expansión"]
    X1["Cobranza al mismo comerciante"]
    X2["Credenciales por tenant"]
    X3["Webhook de Wompi<br/>cierra el circuito del pago"]
    X4["Pantalla de carga de cartera"]
    X5["Panel de aprobación"]
    X6["Pantalla de Cumplimiento"]
  end

  P0 ==> I1
  P2 ==> L1
  P3 ==> L3
  AHORA --> S1 --> S2 --> S3 --> S4 --> DESP

  classDef bloq fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-width:3px
  class P0 bloq
```

**La lógica de la secuencia**, que no es obvia mirando el código:

- Conciliación va primero porque es el producto pequeño y **es el cliente más
  cercano**: dos cerrados, ambos Bancolombia. Cobranza es la expansión sobre el
  mismo comerciante, no un producto distinto.
- Por eso `src/ingest`, `src/cadence` y el resto de `src/compliance` no están
  dormidos: son la otra mitad de un solo sistema, esperando su cliente.
- Alcance v1 **solo inbound**. El riesgo de que Meta tumbe el número vive en el
  outbound; sin cobro proactivo no hay riesgo real. Y los mensajes de servicio
  dentro de la ventana de 24 h no consumen cupo, así que el volumen nunca fue la
  limitante: el único motivo para esperar la verificación de Meta es el cupo de
  2 números.
- El cruce es **determinístico**. No se le delega a un modelo decidir si dos
  registros son el mismo pago. El modelo lee la imagen; la decisión es código.
- Mientras no haya aviso del banco, el cliente ve *"estamos verificando"*, nunca
  *"confirmado"*. Un comprobante falso nunca produce una confirmación: produce
  una revisión.

---

## 8. Las tres decisiones que no conviene revisitar sin leer el porqué

1. **El dinero nunca pasa por nosotros.** La cuenta de la pasarela es del
   cliente. Recaudar y girar sería actividad de agregador, con exposición ante
   la SFC y SARLAFT.
2. **WhatsApp va por Meta Cloud API directo, no por un revendedor.** Un BSP
   cobra USD 0.005 encima de cada mensaje, entrante y saliente, incluidos los de
   la ventana de 24 h que Meta regala — que en un agente conversacional son el
   grueso del tráfico. La plantilla baja de COP 24 a COP 3,2 y la conversación
   de COP 20 a cero.
3. **La unidad de costo de IA es la conversación, no el token.** El cupo de
   conversaciones ya es el tope de exposición. La vara son los COP 180 del
   excedente vendido por conversación; la primera palanca de optimización es
   caché de prompt, porque el prefijo de `construirPrompt` es idéntico entre
   llamadas.

---

## 9. Comandos

```bash
nvm use                # Node 22 obligatorio
pnpm test              # 950 tests, 12,6 s
pnpm test:e2e          # 5 rojos a propósito: la especificación de conciliación
pnpm typecheck
pnpm migrar            # aplica las 11 migraciones
pnpm sembrar           # tenant de demo con cartera, hilos y mensajes
pnpm tsx scripts/borrar-tenant.mts <uuid>   # vaciar antes de resembrar; dry-run salvo --si-borrar
pnpm simular           # mensaje entrante por el camino real del webhook
pnpm auditoria         # lee agent_events
pnpm verificar-db
pnpm dev               # landing en /, consola en /consola, demo en /demo
```
