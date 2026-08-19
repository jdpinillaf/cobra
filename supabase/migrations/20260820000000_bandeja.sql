-- Bandeja de conversaciones.
--
-- Lo que convierte el motor en una herramienta con la que un equipo trabaja:
-- quién tiene cada hilo, cuál está sin leer, cuál frenó un asesor, y qué se
-- anotó por dentro.
--
-- Dos separaciones a propósito, y ninguna es cosmética:
--
--   notas ≠ contactos       `contactos` es la evidencia ante la SIC de intentos
--                           de contacto reales. Una nota del equipo no es un
--                           intento de contacto; meterla ahí ensucia la prueba.
--
--   pausa ≠ opt-out         La pausa es operativa y reversible: un asesor tomó
--                           la conversación. El opt-out es del deudor, de ley,
--                           y no se deshace desde la consola.

ALTER TABLE conversaciones
  -- El bot calla. La cadencia programada sigue: son dos cosas distintas.
  ADD COLUMN agente_pausado   boolean NOT NULL DEFAULT false,
  ADD COLUMN pausada_por      uuid REFERENCES tenant_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN pausada_en       timestamptz,
  ADD COLUMN motivo_pausa     text,
  ADD COLUMN asignada_a       uuid REFERENCES tenant_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN asignada_en      timestamptz,
  -- Ordena la bandeja sin subconsulta sobre contactos.
  ADD COLUMN ultimo_mensaje_en  timestamptz,
  -- Contra `lecturas.leido_hasta` da el sin-leer con una comparación, sin COUNT.
  ADD COLUMN ultimo_entrante_en timestamptz,
  ADD COLUMN estado           text NOT NULL DEFAULT 'abierta'
                              CHECK (estado IN ('abierta','cerrada'));

-- Un solo hilo abierto por deudor.
--
-- El índice garantiza la invariante, no la idempotencia: sin `ON CONFLICT` en el
-- INSERT, dos entrantes simultáneos del mismo deudor terminan en un 23505 en vez
-- de reutilizar el hilo. Y sí toma lock: un INSERT contra un índice único espera
-- el commit de la transacción que está insertando la misma llave.
CREATE UNIQUE INDEX conversacion_abierta_por_deudor
  ON conversaciones (tenant_id, deudor_id) WHERE cerrada_en IS NULL;

CREATE INDEX ON conversaciones (tenant_id, asignada_a, ultimo_mensaje_en DESC)
  WHERE cerrada_en IS NULL;

-- Todo lo que el reparto por turnos necesita saber.
ALTER TABLE tenant_usuarios
  ADD COLUMN activo               boolean NOT NULL DEFAULT true,
  ADD COLUMN recibe_asignaciones  boolean NOT NULL DEFAULT true,
  -- Para avisarle por WhatsApp. Apagado por defecto: cada aviso fuera de
  -- ventana es una plantilla, y una plantilla consume cupo del cliente.
  ADD COLUMN telefono             text,
  ADD COLUMN recibe_whatsapp      boolean NOT NULL DEFAULT false,
  -- El turno. Se le asigna al que hace más rato que no recibe nada.
  ADD COLUMN ultima_asignacion    timestamptz;

-- Comentarios internos. Nunca salen hacia el deudor.
CREATE TABLE notas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversacion_id uuid NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  usuario_id     uuid REFERENCES tenant_usuarios(id) ON DELETE SET NULL,
  cuerpo         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Catálogo por tenant. `tono` sale de los tres colores semánticos del sistema
-- de diseño, así que una etiqueta nueva no puede inventar un color suelto.
CREATE TABLE etiquetas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  tono       text NOT NULL DEFAULT 'neutro'
             CHECK (tono IN ('entregado','diferido','bloqueado','neutro')),
  UNIQUE (tenant_id, nombre)
);

CREATE TABLE conversacion_etiquetas (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversacion_id uuid NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  etiqueta_id     uuid NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, conversacion_id, etiqueta_id)
);

-- El sin-leer es por persona, no por conversación: que Marcela haya leído un
-- hilo no significa que Andrés lo haya visto.
--
-- Ojo con el alcance: la llave primaria es por persona, pero la política de RLS
-- es por tenant. Cualquier operador del mismo cliente puede escribir el
-- `leido_hasta` ajeno. Está dentro del perímetro de confianza del cliente y se
-- deja así a propósito; si algún día hace falta separar por usuario, la política
-- tiene que mirar también `usuario_id`.
CREATE TABLE lecturas (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversacion_id uuid NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  usuario_id      uuid NOT NULL REFERENCES tenant_usuarios(id) ON DELETE CASCADE,
  leido_hasta     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, conversacion_id, usuario_id)
);

-- Alimenta la campana y los otros dos canales.
CREATE TABLE notificaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id      uuid NOT NULL REFERENCES tenant_usuarios(id) ON DELETE CASCADE,
  conversacion_id uuid REFERENCES conversaciones(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  -- Evita avisar dos veces por lo mismo. Mismo truco que `avisos_cupo`.
  clave_dedupe    text NOT NULL,
  creada_en       timestamptz NOT NULL DEFAULT now(),
  vista_en        timestamptz,
  enviada_whatsapp_en timestamptz,
  enviada_correo_en   timestamptz,
  -- El WhatsApp interno cuesta plata y no va a `contactos`: esa tabla es
  -- evidencia sobre deudores, no sobre avisos al equipo.
  costo_cop       numeric(12,4) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, usuario_id, clave_dedupe)
);

-- Sesión con estado, para poder revocarla. La cookie lleva el id firmado.
--
-- Nota de seguridad: la búsqueda de sesión corre necesariamente con la llave de
-- servicio, porque todavía no se sabe de qué tenant es el request. Es el único
-- lugar donde eso es correcto: es la frontera de autenticación, justo el punto
-- donde el tenant se descubre en vez de asumirse.
CREATE TABLE sesiones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES tenant_usuarios(id) ON DELETE CASCADE,
  expira_en  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON notas          (tenant_id, conversacion_id, created_at);
CREATE INDEX ON notificaciones (tenant_id, usuario_id, vista_en, creada_en DESC);
CREATE INDEX ON sesiones       (expira_en);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notas','etiquetas','conversacion_etiquetas','lecturas','notificaciones','sesiones'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;
