-- Esquema de conciliación.
--
-- RLS activo en todas las tablas desde la primera migración, y no porque
-- proteja al worker: el worker usa la service key y la service key ignora RLS
-- por completo. RLS es la red para el query suelto que alguien va a escribir
-- algún día sin filtrar por tenant. El aislamiento de verdad lo hace src/repo.
--
-- La política lee `app.tenant_id` de la sesión. Sin ese setting devuelve NULL,
-- la comparación da NULL y no sale ninguna fila: falla cerrado.

CREATE TABLE tenants (
  id                uuid PRIMARY KEY,
  nombre            text NOT NULL,
  nit               text,
  email_contacto    text,
  cuenta_ultimos4   text,
  cuenta_titular    text,
  email_alias       text UNIQUE,
  dkim_dominio_esperado text NOT NULL DEFAULT 'notificacionesbancolombia.com',
  wa_propietario    text CHECK (wa_propietario IN ('ponox', 'cliente')),
  waba_id           text,
  phone_number_id   text UNIQUE,
  wa_token_cifrado  text,
  wa_origen_token   text CHECK (wa_origen_token IN ('system_user', 'embedded_signup')),
  sheet_id          text,
  -- Un comerciante puede conciliar, cobrar, o las dos. Activarle la segunda es
  -- un UPDATE, no una migración.
  capacidades       text[] NOT NULL DEFAULT '{}',
  zona_horaria      text NOT NULL DEFAULT 'America/Bogota',
  estado            text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','verificando','activo','pausado')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Absorbe al Cliente de src/domain/types.ts. Existe solo si 'cobranza' está en
-- capacidades; hoy puede estar vacía.
CREATE TABLE tenant_cobranza (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tier              text,
  cupo_mensajes_mes integer,
  limites_por_tramo jsonb NOT NULL DEFAULT '{}'
);

-- Config que solo puede restringir, nunca ampliar: el dominio DKIM esperado va
-- en la fila, así que agregar un remitente mal puesto no abre el hueco.
CREATE TABLE tenant_email_senders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direccion     text NOT NULL,
  dkim_dominio_esperado text NOT NULL,
  activo        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, direccion)
);

-- Nunca se descarta nada. El día que Bancolombia cambie la redacción, el correo
-- que no parseó es la única evidencia de qué cambió.
CREATE TABLE raw_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- La deduplicación real. La huella no sirve para esto.
  message_id    text NOT NULL,
  -- MIME exacto como llegó. DKIM se verifica sobre estos bytes; una conversión
  -- de charset rompe el hash del cuerpo y la firma falla sin motivo aparente.
  crudo         text NOT NULL,
  from_addr     text,
  subject       text,
  dkim_ok       boolean,
  dkim_domain   text,
  clasificacion text CHECK (clasificacion IN ('ingreso','egreso','seguridad','otro','desconocido')),
  parse_ok      boolean,
  cuarentena    boolean NOT NULL DEFAULT false,
  motivo        text,
  recibido_at   timestamptz NOT NULL DEFAULT now(),
  banco_at      timestamptz,
  UNIQUE (tenant_id, message_id)
);

CREATE TABLE bank_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_email_id    uuid NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  monto_centavos  bigint NOT NULL,
  remitente_raw   text,
  remitente_norm  text,
  cuenta_ultimos4 text,
  ocurrido_en     timestamptz NOT NULL,
  -- Índice, NO constraint. Dos pagos genuinos idénticos en el mismo minuto
  -- existen; un UNIQUE perdería el segundo en silencio. Una colisión enruta a
  -- revisión, que es lo que el plan dice y lo que el UNIQUE impedía cumplir.
  huella          text NOT NULL
);

CREATE TABLE cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estado      text NOT NULL DEFAULT 'esperando'
              CHECK (estado IN ('esperando','aprobado','revisar')),
  motivo      text NOT NULL DEFAULT '',
  abierto_at  timestamptz NOT NULL DEFAULT now(),
  cerrado_at  timestamptz
);

CREATE TABLE payment_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id        uuid REFERENCES cases(id) ON DELETE SET NULL,
  telefono       text NOT NULL,
  -- Idempotencia contra la reentrega de Meta.
  wa_message_id  text NOT NULL,
  imagen_url     text,
  monto_centavos bigint,
  ocr_json       jsonb,
  recibido_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wa_message_id)
);

CREATE TABLE reconciliations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  claim_id        uuid NOT NULL REFERENCES payment_claims(id) ON DELETE CASCADE,
  -- El antifraude real: un aviso concilia una sola vez, y lo garantiza la base,
  -- no el código.
  notification_id uuid NOT NULL UNIQUE REFERENCES bank_notifications(id) ON DELETE CASCADE,
  estado          text NOT NULL CHECK (estado IN ('aprobado','pendiente','revisar')),
  score           numeric,
  motivo          text NOT NULL DEFAULT '',
  resuelto_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reconciliation_id  uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  -- Quién movió plata. No texto libre.
  user_id            uuid,
  decision           text NOT NULL,
  comentario         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Sirve a los dos productos: ocr/parse_email/match son de
-- conciliación, envio/escalado/acuerdo son de cobranza. Una tabla, una vista de
-- traza, y la observabilidad que promete la landing cubre a los dos agentes.
CREATE TABLE agent_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id     uuid REFERENCES cases(id) ON DELETE CASCADE,
  paso        text NOT NULL,
  decision    text,
  motivo      text NOT NULL DEFAULT '',
  -- El intento que NO salió. Sin esto la traza cuenta solo la mitad.
  bloqueado_por text,
  proveedor   text,
  tokens_in   integer,
  tokens_out  integer,
  costo_usd   numeric,
  latencia_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- La cola. No hace falta pg-boss ni un proceso vivo: todo lo dispara un
-- webhook y el cron es la red para lo que quedó colgado.
CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','corriendo','listo','fallido')),
  intentos        integer NOT NULL DEFAULT 0,
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  ultimo_error    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices. Cuestan cero con dos clientes y duelen a los diez.
CREATE INDEX ON bank_notifications (tenant_id, monto_centavos, ocurrido_en);
CREATE INDEX ON bank_notifications (tenant_id, huella);
CREATE INDEX ON payment_claims     (tenant_id, monto_centavos, recibido_at);
CREATE INDEX ON agent_events       (tenant_id, case_id, id);
CREATE INDEX ON raw_emails         (tenant_id, recibido_at DESC);
CREATE INDEX ON jobs               (estado, proximo_intento);

-- RLS en todo. `tenants` compara contra su propia id; el resto contra tenant_id.
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_cobranza','tenant_email_senders','raw_emails','bank_notifications',
    'cases','payment_claims','reconciliations','approvals','agent_events','jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;
