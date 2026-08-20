-- Poder mostrar el producto sin abrirle una puerta al que no debe.
--
-- La consola necesita un botón que escriba como si escribiera el deudor: sin él
-- no hay forma de armar una demo ni de recrear un caso para depurarlo. Pero el
-- repo ya tenía escrita la objeción, en `scripts/simular-entrante.mts`:
--
--   "Por eso no hay un botón en la consola que inyecte mensajes: un camino que
--    solo existe para la demo es el que después queda encendido donde no debe."
--
-- Sigue siendo cierta, así que el botón no crea ese camino: el mensaje inyectado
-- pasa por `procesarWebhook`, la misma función que corre el webhook de Meta, con
-- el tenant salido de la sesión y no del payload. Lo que agrega esta bandera es
-- la última cerradura: sin ella la acción rechaza y el botón no se dibuja.
--
-- `false` por defecto a propósito. Un tenant nuevo —o sea, un cliente real— no
-- tiene el botón hasta que alguien decida encenderlo, y encenderlo es un UPDATE
-- que queda escrito.
ALTER TABLE tenants
  ADD COLUMN modo_demo boolean NOT NULL DEFAULT false;
