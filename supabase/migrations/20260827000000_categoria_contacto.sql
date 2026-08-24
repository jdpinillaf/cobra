-- Con qué se facturó cada mensaje.
--
-- La categoría se decidía (`categoriaDelEnvio`), se usaba para cobrar
-- (`meta-cloud.ts`) y se tiraba. Peor: la categoría con la que Meta **realmente**
-- facturó llega en el webhook de estado, se usa para corregir `costo_cop` y
-- también se descarta. Sin la columna no se puede responder "cuánto se fue en
-- marketing", que es la pregunta que decide si el canal es rentable.
--
-- Derivarla del costo no sirve. El rate card ya cambió una vez —la cabecera de
-- `tarifas.ts` fecha el vigente en abril de 2026— y con cualquier tarifa una
-- `utility` gratuita sería indistinguible de un `servicio`.
--
-- `servicio` no es una categoría de plantilla: es el texto libre dentro de la
-- ventana de 24 h, que Meta no cobra. Va en el mismo CHECK porque a efectos de
-- facturación es una opción más, y separarla en otra columna obligaría a
-- consultar dos campos para responder una sola pregunta.
ALTER TABLE contactos
  ADD COLUMN categoria text
    CHECK (categoria IN ('utility','marketing','authentication','servicio')),
  -- El id de conversación de Meta. Es la llave para conciliar su factura contra
  -- la nuestra línea por línea; se parseaba desde el primer día y no tenía
  -- dónde ir.
  ADD COLUMN conversacion_meta text;

-- La pantalla de consumo agrupa por mes y categoría. El índice existente es
-- (tenant_id, ocurrido_en DESC) y sirve para el rango; esto evita releer las
-- filas para el GROUP BY.
CREATE INDEX ON contactos (tenant_id, categoria, ocurrido_en DESC)
  WHERE categoria IS NOT NULL;
