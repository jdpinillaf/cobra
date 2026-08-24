#!/usr/bin/env tsx
/**
 * Chequeo previo al deploy.
 *
 * No publica: verifica que estén las cinco cosas sin las cuales la app sube y no
 * funciona. Es más barato descubrirlo acá que en una URL que alguien ya abrió.
 */
const REQUERIDAS = [
  ['DATABASE_URL', 'sin ella la app cae a PGlite, que en Vercel es una base vacía por instancia'],
  ['SESION_SECRETO', 'la consola no arranca sin secreto de sesión, y tiene que tener 32+ caracteres'],
  ['CRON_SECRETO', 'sin él la ruta del cron no atiende, y con él abierto cualquiera dispara la cadencia'],
  ['META_APP_SECRET', 'verifica la firma de los webhooks de WhatsApp'],
  ['META_TOKEN_VERIFICACION', 'el handshake de suscripción del webhook'],
] as const

let faltan = 0
console.log('')
for (const [clave, porque] of REQUERIDAS) {
  const valor = process.env[clave]
  const ok = clave === 'SESION_SECRETO' ? (valor?.length ?? 0) >= 32 : Boolean(valor)
  console.log(`  ${ok ? 'ok  ' : 'FALTA'}  ${clave.padEnd(24)} ${ok ? '' : porque}`)
  if (!ok) faltan += 1
}

console.log(
  faltan === 0
    ? '\n  Listo para publicar.\n'
    : `\n  ${faltan} variable(s) sin configurar. En Vercel: Settings → Environment Variables.\n`,
)
process.exit(faltan === 0 ? 0 : 1)
