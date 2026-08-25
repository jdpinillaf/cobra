-- Canal de voz: la llamada, su transcripción y lo que el agente ejecutó.
--
-- Tres decisiones que conviene leer antes de tocar nada.
--
-- 1. **Una llamada también escribe una fila en `contactos`.** El guard cuenta
--    la frecuencia de la Ley 2300 cruzando canales, nunca por canal. Si la
--    llamada no dejara `Contacto`, el agente podría llamar a las 10 y escribir
--    por WhatsApp a las 11 — el hostigamiento exacto que el guard existe para
--    impedir. `llamadas` es el detalle de cómo fue; `contactos` es lo que
--    cuenta ante la SIC.
--
-- 2. **La transcripción va por turnos y se escribe durante la llamada**, no al
--    final. Una llamada que se corta es justo la que hay que revisar, y con un
--    `text` acumulado al cierre se perdería entera.
--
-- 3. **El costo va partido en telefonía e IA.** Son dos negociaciones
--    distintas: el minuto de Twilio baja comprando volumen, el de Deepgram
--    cambiando de modelo. Un total pelado no deja ver cuál palanca mover.

-- ── Los tres CHECK de canal ──────────────────────────────────────────────────
--
-- `contactos.canal`: una llamada es un intento de contacto (ver 1).
-- `deudores.pref_canal`: el deudor puede elegir canal, y «no me llamen,
--   escríbanme» es la preferencia más común que existe. Sin esto el guard no la
--   puede representar y `canal_distinto_al_preferido` nunca se dispara por voz.
-- `plantillas.canal`: por simetría. En v1 no se usa: el saludo de la llamada no
--   es una plantilla aprobada por Meta.
ALTER TABLE contactos  DROP CONSTRAINT contactos_canal_check;
ALTER TABLE contactos  ADD  CONSTRAINT contactos_canal_check
  CHECK (canal IN ('whatsapp','sms','voz'));

ALTER TABLE deudores   DROP CONSTRAINT deudores_pref_canal_check;
ALTER TABLE deudores   ADD  CONSTRAINT deudores_pref_canal_check
  CHECK (pref_canal IN ('whatsapp','sms','voz'));

ALTER TABLE plantillas DROP CONSTRAINT plantillas_canal_check;
ALTER TABLE plantillas ADD  CONSTRAINT plantillas_canal_check
  CHECK (canal IN ('whatsapp','sms','voz'));

-- Para poder referenciarla desde `llamadas` con la llave compuesta que impone
-- 20260821000000_fk_por_tenant.sql: la foránea lleva el tenant adentro, así que
-- apuntar a otro tenant lo rechaza la base y no una regla que hay que recordar.
ALTER TABLE contactos ADD CONSTRAINT contactos_tenant_id_key UNIQUE (tenant_id, id);

-- ── La llamada ───────────────────────────────────────────────────────────────
CREATE TABLE llamadas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deudor_id       uuid NOT NULL,
  -- Nullable por el mismo motivo que en `contactos`: un número errado puede
  -- generar una llamada que no pertenece a ninguna obligación.
  obligacion_id   uuid,
  conversacion_id uuid,
  -- La fila de cumplimiento que originó o resumió esta llamada.
  contacto_id     uuid,

  direccion       text NOT NULL CHECK (direccion IN ('entrante','saliente')),
  telefono        text NOT NULL,
  proveedor       text NOT NULL CHECK (proveedor IN ('twilio','simulado')),
  -- CallSid en Twilio. La única llave para correlacionar el status callback.
  id_proveedor    text,
  stream_sid      text,
  -- 'deepgram/aura-2-...' | 'simulado'. Queda escrito con qué voz se habló:
  -- cambiar de modelo a mitad de un piloto y no poder distinguir las llamadas
  -- después es perder el experimento.
  agente          text NOT NULL,

  estado          text NOT NULL DEFAULT 'marcando'
                  CHECK (estado IN ('marcando','en_curso','finalizada','fallida',
                                    'no_contesto','buzon')),
  motivo_fin      text,
  -- Se deriva de las acciones ejecutadas, no del texto. Un resumen escrito por
  -- un modelo puede decir «quedamos en un acuerdo» sin que exista el acuerdo.
  resultado       text CHECK (resultado IN ('acuerdo','promesa','sin_acuerdo',
                                            'numero_errado','escalado','sin_contacto')),
  resumen         text,

  iniciada_en     timestamptz NOT NULL DEFAULT now(),
  contestada_en   timestamptz,
  finalizada_en   timestamptz,
  duracion_seg    integer,

  -- Decimal, igual que `contactos.costo_cop`: un minuto de Twilio a Colombia
  -- vale COP 151 y el redondeo a entero se come el margen.
  costo_telefonia_cop numeric(12,4) NOT NULL DEFAULT 0,
  costo_ia_cop        numeric(12,4) NOT NULL DEFAULT 0,
  grabacion_url   text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT llamadas_deudor_fk FOREIGN KEY (tenant_id, deudor_id)
    REFERENCES deudores (tenant_id, id) ON DELETE CASCADE,
  -- `SET NULL` acotado a la columna: sin acotar anularía también `tenant_id`,
  -- que es NOT NULL, y el borrado reventaría. Postgres 15+.
  CONSTRAINT llamadas_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE SET NULL (obligacion_id),
  CONSTRAINT llamadas_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE SET NULL (conversacion_id),
  CONSTRAINT llamadas_contacto_fk FOREIGN KEY (tenant_id, contacto_id)
    REFERENCES contactos (tenant_id, id) ON DELETE SET NULL (contacto_id)
);

ALTER TABLE llamadas ADD CONSTRAINT llamadas_tenant_id_key UNIQUE (tenant_id, id);

-- ── La transcripción ─────────────────────────────────────────────────────────
CREATE TABLE llamada_turnos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  llamada_id  uuid NOT NULL,
  indice      integer NOT NULL,
  quien       text NOT NULL CHECK (quien IN ('deudor','agente','sistema')),
  texto       text NOT NULL,
  -- Un turno del agente que el deudor pisó. Se guarda porque una transcripción
  -- que muestra la frase entera miente sobre lo que la persona alcanzó a oír.
  interrumpido boolean NOT NULL DEFAULT false,
  ms_desde_inicio integer NOT NULL DEFAULT 0,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT llamada_turnos_llamada_fk FOREIGN KEY (tenant_id, llamada_id)
    REFERENCES llamadas (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, llamada_id, indice)
);

-- ── Lo que el agente ejecutó ─────────────────────────────────────────────────
--
-- `agent_events` ya recibe un paso por herramienta vía `anotarPaso`, y esa
-- sigue siendo la traza que lee la consola. Esta tabla existe por lo que
-- `agent_events` no guarda: el JSON crudo que mandó el modelo, el que devolvió
-- la herramienta y cuánto tardó. En una llamada eso es la diferencia entre «el
-- agente se quedó callado» y «el modelo mandó montoAcordado como texto».
CREATE TABLE llamada_acciones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  llamada_id    uuid NOT NULL,
  turno_indice  integer,
  herramienta   text NOT NULL,
  argumentos    jsonb NOT NULL DEFAULT '{}',
  resultado     jsonb,
  -- `bloqueado` es la herramienta que corrió y dijo que no: un acuerdo fuera de
  -- rango. No es un error, es el producto funcionando.
  estado        text NOT NULL CHECK (estado IN ('ok','bloqueado','error')),
  latencia_ms   integer,
  ocurrido_en   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT llamada_acciones_llamada_fk FOREIGN KEY (tenant_id, llamada_id)
    REFERENCES llamadas (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ON llamadas (tenant_id, iniciada_en DESC);
CREATE INDEX ON llamadas (tenant_id, deudor_id, iniciada_en DESC);
CREATE INDEX ON llamadas (id_proveedor);
CREATE INDEX ON llamada_turnos (tenant_id, llamada_id, indice);
CREATE INDEX ON llamada_acciones (tenant_id, llamada_id, ocurrido_en);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['llamadas','llamada_turnos','llamada_acciones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;
