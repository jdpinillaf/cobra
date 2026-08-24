# Notas de despliegue

## El cron está en diario, y no alcanza

`vercel.json` declara `0 13 * * *` (8:00 en Bogotá) porque **Vercel Hobby solo
permite un cron por día**. El deploy falla con cualquier otra frecuencia.

Una cadencia de cobranza necesita correr cada 15 minutos: un paso que hoy queda
fuera de la ventana legal a las 8:05 se reprograma para las 8:20, y con un cron
diario ese paso espera hasta mañana. Con 24 horas de granularidad el motor
funciona pero llega tarde a casi todo.

**Para producción real hace falta Vercel Pro** (~USD 20/mes) y volver a
`*/15 * * * *`.

## El motor está apagado a propósito

No hay `CRON_SECRETO` cargado, así que `/api/cron/tick` devuelve 401 y no manda
nada. Es deliberado: son commits que revisó una sola persona, y el motor manda
mensajes de WhatsApp reales.

Para encenderlo:

    openssl rand -hex 32 | vercel env add CRON_SECRETO production --yes

Y el mismo valor en la configuración del cron de Vercel.

## Falta para que WhatsApp funcione de verdad

| Variable | De dónde sale |
|---|---|
| `META_APP_SECRET` | Meta → app → Configuración básica |
| `META_PHONE_NUMBER_ID` | Meta → WhatsApp → número |
| `META_WABA_ID` | Meta → WhatsApp |
| `META_ACCESS_TOKEN` | System User del Business Manager |
| `PROVEEDOR_WHATSAPP=meta` | sin esto usa el proveedor simulado |

`META_TOKEN_VERIFICACION` ya está cargada; ese mismo valor va en el panel de
Meta al registrar la URL del webhook:

    https://<dominio>/api/whatsapp/webhook

Y hay que poner el `phone_number_id` en `tenants.phone_number_id`, que es el
discriminador con el que el webhook decide de qué cliente es cada mensaje.

## El agente ya contesta

Un mensaje entrante dispara una respuesta del agente. Corre **después** de la
respuesta HTTP (`after()` de Next), así que Meta recibe su 200 enseguida y el
turno del modelo no deja abierta la transacción del webhook.

Dónde sale y dónde no:

- **Sin `PROVEEDOR_WHATSAPP=meta` no sale nada a la red.** El proveedor por
  defecto es el simulado: escribe la fila en `contactos` y no llama a nadie.
- La compuerta lo calla ante las prohibiciones absolutas —baja pedida, número
  errado, sin consentimiento, obligación cerrada— y cuando un asesor tomó el
  hilo. **Un domingo sí contesta**: la Ley 2300 limita cuándo la empresa
  contacta, no si puede responderle a quien acaba de escribir.
- Lo que puede ofrecer sale de `tenant_cobranza.limites_por_tramo`. Vacío
  significa **no negocia nada**: sin descuento, una sola cuota. Un cliente nuevo
  nace así hasta que se le carguen sus límites por escrito.

Un turno del modelo tardó **18 segundos** en la prueba local. Para WhatsApp es
mucho: conviene medirlo en la pantalla de Consumo antes de encenderlo con un
cliente.

### Dos límites del agente que hoy no se ven

**Un solo número remitente para todos los clientes.** El webhook resuelve de
qué cliente es cada mensaje por `tenants.phone_number_id`, pero
`crearProveedores` arma el proveedor con `META_PHONE_NUMBER_ID` del entorno, y
ese id **es** el remitente. Con un solo cliente no se nota. Con dos vivos en la
misma WABA, el agente le contestaría al deudor del segundo desde el número del
primero. El arreglo son credenciales por tenant, no una línea.

**En el camino del agente, RLS no aplica.** El turno corre en `after()`, fuera
de la transacción de `conTenant` — a propósito, porque esperar al modelo con
una conexión reservada vacía el pool. El costo es que ahí el aislamiento
depende del `WHERE tenant_id` de cada consulta del repositorio, sin la red de
seguridad de las políticas. Está revisado consulta por consulta; lo que no hay
es algo que lo verifique solo mañana.

## El modo demo, y por qué no es un agujero

`tenants.modo_demo` habilita en la consola un redactor que escribe **como si
escribiera el deudor**. Sirve para mostrar el producto y para reproducir un caso
sin esperar a que alguien conteste.

Nace en `false`. El tenant sembrado lo tiene en `true` porque su cartera es
inventada; encenderlo en un cliente real es un UPDATE que queda escrito.

No abre un camino nuevo: el mensaje entra por `procesarWebhook`, la misma
función que corre cuando llama Meta, con el tenant salido de la sesión y no del
payload. Y queda marcado `proveedor = 'simulado'` en la fila para siempre, así
que no se cuenta como evidencia ante la SIC ni suma en la pantalla de Consumo.

## Los datos son de demostración

La cartera, las 40 conversaciones y los ~410 mensajes son generados. Los
nombres, teléfonos y saldos son inventados. Antes de cargar cartera real
conviene borrar el tenant de demo, no mezclarlos.

Los hilos siguen ocho guiones —promesa de pago, acuerdo de cuotas, disputa,
número errado, baja, sin respuesta, situación difícil, apenas abierto— y cada
uno deja el estado que le corresponde: el que pidió la baja queda no
contactable, el del número errado queda marcado y pausado.

## Migraciones nuevas desde el último despliegue

Correr `pnpm migrar` antes de que la app arranque. Son cuatro:

| Migración | Qué agrega |
|---|---|
| `20260824000000_numero_errado` | `deudores.numero_errado_en` |
| `20260825000000_contacto_sin_obligacion` | `contactos.obligacion_id` pasa a nullable |
| `20260826000000_modo_demo` | `tenants.modo_demo` |
| `20260827000000_categoria_contacto` | `contactos.categoria` y `conversacion_meta` |

La de `obligacion_id` arregla una caída real: el deudor que ya pagó todo escribe
y el webhook perdía el mensaje entero con «invalid input syntax for type uuid».

## La base se pausa

Supabase capa gratuita suspende el proyecto tras 7 días sin actividad. Si la
consola aparece caída, puede ser eso: se despierta desde el panel de Supabase.
