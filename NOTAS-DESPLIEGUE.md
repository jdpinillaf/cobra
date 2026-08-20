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

## Los datos son de demostración

La cartera, las 40 conversaciones y los 362 mensajes son generados. Los nombres,
teléfonos y saldos son inventados. Antes de cargar cartera real conviene borrar
el tenant de demo, no mezclarlos.

## La base se pausa

Supabase capa gratuita suspende el proyecto tras 7 días sin actividad. Si la
consola aparece caída, puede ser eso: se despierta desde el panel de Supabase.
