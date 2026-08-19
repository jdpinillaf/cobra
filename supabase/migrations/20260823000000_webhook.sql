-- Lo que el webhook necesita para ser real.
--
-- La idempotencia deja de vivir en un `Set` de proceso. Meta reintenta hasta
-- recibir un 200, y con dos instancias en Vercel el Set de una no sabe nada del
-- de la otra: el mismo mensaje entra dos veces y el deudor recibe dos
-- respuestas. La llave es la única forma de que la deduplicación sobreviva a un
-- reinicio y sea compartida.
CREATE TABLE webhook_procesados (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  llave       text NOT NULL,
  procesado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, llave)
);

ALTER TABLE webhook_procesados ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento ON webhook_procesados
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Adjuntos. Sin el id de media el archivo se pierde: la URL de descarga de Meta
-- vence a los cinco minutos y no se puede volver a pedir. Es lo que sostiene la
-- recepción de comprobantes.
ALTER TABLE contactos
  ADD COLUMN media_id   text,
  ADD COLUMN media_mime text,
  -- URL en nuestro almacenamiento, una vez descargado. Nula mientras no se baje.
  ADD COLUMN media_url  text;

-- La ventana de servicio la dice Meta en `conversation.expiration_timestamp`.
-- Guardar de dónde salió permite distinguir la que él confirmó de la que
-- calculamos desde el entrante, que es una aproximación.
ALTER TABLE ventanas_servicio
  ADD COLUMN origen text NOT NULL DEFAULT 'calculada'
             CHECK (origen IN ('calculada', 'meta'));

CREATE INDEX ON webhook_procesados (procesado_en);
