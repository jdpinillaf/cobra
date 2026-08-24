-- Esquema de cobranza.
--
-- Extiende el de conciliación sin tocarlo: mismo `tenants`, mismo `agent_events`,
-- mismas reglas de RLS. Un comerciante puede tener una capacidad, la otra, o las
-- dos, y activarle la segunda es un UPDATE sobre `tenants.capacidades`.
--
-- Refleja 1:1 los tipos Zod de src/domain/types.ts, que ya llevan `clienteId` en
-- todo. Dos convenciones de dinero conviven a propósito:
--
--   *_centavos bigint    cartera. Entero, sin float, nunca.
--   costo_cop numeric    costo de mensajería. Una plantilla utility cuesta
--                        COP 3,2 y redondearla a entero la vuelve cero.

-- Cupos de la cotización: conversaciones y plantillas son dos cubos separados,
-- no uno. `cupo_mensajes_mes` (un solo cubo) no puede facturar el excedente que
-- se vendió.
ALTER TABLE tenant_cobranza
  ADD COLUMN cupo_conversaciones_mes      integer NOT NULL DEFAULT 3000,
  ADD COLUMN cupo_plantillas_mes          integer NOT NULL DEFAULT 6000,
  ADD COLUMN excedente_conversacion_cop   integer NOT NULL DEFAULT 180,
  ADD COLUMN excedente_plantilla_cop      integer NOT NULL DEFAULT 35,
  ADD COLUMN umbral_aviso_pct             integer NOT NULL DEFAULT 80;

CREATE TABLE deudores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo_documento text NOT NULL CHECK (tipo_documento IN ('CC','CE','NIT','TI','PA','PEP','OTRO')),
  documento      text NOT NULL,
  nombre         text NOT NULL,
  -- El primero es el principal. E.164.
  telefonos      text[] NOT NULL DEFAULT '{}',
  email          text,
  -- 'referencia' la bloquea el guard siempre: art. 3 de la Ley 2300.
  rol            text NOT NULL DEFAULT 'titular'
                 CHECK (rol IN ('titular','codeudor','solidario','referencia')),
  -- Consentimiento. `revocado_en` es el opt-out y es absoluto.
  consentimiento_otorgado boolean NOT NULL DEFAULT false,
  consentimiento_fuente   text CHECK (consentimiento_fuente IN ('pagare','formulario_web','contrato','importado')),
  consentimiento_fecha    timestamptz,
  revocado_en             timestamptz,
  -- Preferencias del deudor. Solo estrechan la ventana legal, nunca la amplían.
  pref_canal      text CHECK (pref_canal IN ('whatsapp','sms')),
  pref_dia_semana integer CHECK (pref_dia_semana BETWEEN 1 AND 6),
  pref_hora_desde integer CHECK (pref_hora_desde BETWEEN 0 AND 23),
  pref_hora_hasta integer CHECK (pref_hora_hasta BETWEEN 0 AND 23),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo_documento, documento)
);

CREATE TABLE obligaciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deudor_id          uuid NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
  numero_credito     text NOT NULL,
  capital_centavos       bigint NOT NULL,
  interes_mora_centavos  bigint NOT NULL DEFAULT 0,
  saldo_total_centavos   bigint NOT NULL,
  fecha_vencimiento  date NOT NULL,
  dias_mora          integer NOT NULL DEFAULT 0,
  tramo              text NOT NULL
                     CHECK (tramo IN ('preventiva','temprana','media','tardia','castigada')),
  estado             text NOT NULL DEFAULT 'en_mora'
                     CHECK (estado IN ('al_dia','en_mora','acuerdo_vigente','pagada','castigada','juridico')),
  -- Régimen normativo: la Ley 2300 protege personas naturales. La cartera
  -- empresarial opera sin las restricciones de horario. Lo clasifica el cliente.
  regimen            text NOT NULL DEFAULT 'persona_natural'
                     CHECK (regimen IN ('persona_natural','empresarial')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero_credito)
);

-- Una conversación es todo el intercambio con un deudor dentro de una ventana
-- de 24 h. Es la unidad que se factura y la unidad en la que se mide el costo
-- de IA, así que existe como fila y no como cálculo.
CREATE TABLE conversaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deudor_id     uuid NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
  obligacion_id uuid REFERENCES obligaciones(id) ON DELETE SET NULL,
  abierta_en    timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  cerrada_en    timestamptz
);

-- Registro inmutable de TODO intento, incluidos los bloqueados. No es un log:
-- es la evidencia documental ante la SIC de que se respetó la ley, y la fuente
-- del historial que la consola le muestra al cliente.
CREATE TABLE contactos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligacion_id  uuid NOT NULL REFERENCES obligaciones(id) ON DELETE CASCADE,
  deudor_id      uuid NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
  conversacion_id uuid REFERENCES conversaciones(id) ON DELETE SET NULL,
  canal          text NOT NULL CHECK (canal IN ('whatsapp','sms')),
  direccion      text NOT NULL CHECK (direccion IN ('saliente','entrante')),
  ocurrido_en    timestamptz NOT NULL,
  plantilla_id   uuid,
  cuerpo         text NOT NULL DEFAULT '',
  resultado      text NOT NULL
                 CHECK (resultado IN ('encolado','enviado','entregado','leido','fallido','bloqueado')),
  motivo_bloqueo text,
  -- Decimal a propósito. Ver cabecera.
  costo_cop      numeric(12,4) NOT NULL DEFAULT 0,
  -- wamid en Meta, SID en Twilio. Única llave para correlacionar el webhook de
  -- estado con el contacto que lo originó.
  id_proveedor   text,
  proveedor      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ventanas_servicio (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deudor_id  uuid NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
  abierta_en timestamptz NOT NULL,
  expira_en  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, deudor_id)
);

CREATE TABLE plantillas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre            text NOT NULL,
  canal             text NOT NULL CHECK (canal IN ('whatsapp','sms')),
  categoria         text NOT NULL CHECK (categoria IN ('utility','marketing','authentication')),
  -- Nombre tal como quedó aprobado en Meta. Sin esto no se puede enviar.
  nombre_meta       text,
  cuerpo            text NOT NULL,
  variables         text[] NOT NULL DEFAULT '{}',
  aprobada_en_meta  boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, nombre)
);

CREATE TABLE cadencias (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tramo     text NOT NULL
            CHECK (tramo IN ('preventiva','temprana','media','tardia','castigada')),
  -- Es el shape de PasoCadencia: offsetDias, canal, plantillaId, fallbackSms.
  pasos     jsonb NOT NULL DEFAULT '[]',
  activa    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, tramo)
);

-- El `indicesEjecutados` que pasosVencidos ya recibe. El UNIQUE es lo que
-- impide mandar dos veces el mismo paso de la cadencia.
CREATE TABLE cadencia_ejecuciones (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligacion_id uuid NOT NULL REFERENCES obligaciones(id) ON DELETE CASCADE,
  indice_paso   integer NOT NULL,
  ejecutado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, obligacion_id, indice_paso)
);

-- Human-in-the-loop obligatorio: el agente propone, una persona aprueba.
CREATE TABLE acuerdos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligacion_id     uuid NOT NULL REFERENCES obligaciones(id) ON DELETE CASCADE,
  tipo              text NOT NULL CHECK (tipo IN ('pago_total','pago_parcial','cuotas','descuento')),
  monto_acordado_centavos bigint NOT NULL,
  descuento_pct     numeric(5,2) NOT NULL DEFAULT 0,
  numero_cuotas     integer NOT NULL DEFAULT 1,
  primera_cuota_el  date,
  estado            text NOT NULL DEFAULT 'propuesto_por_agente'
                    CHECK (estado IN ('propuesto_por_agente','esperando_aprobacion','aprobado',
                                      'rechazado','vigente','cumplido','incumplido')),
  propuesto_en      timestamptz NOT NULL DEFAULT now(),
  aprobado_por      uuid,
  aprobado_en       timestamptz,
  motivo_rechazo    text
);

CREATE TABLE pagos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligacion_id   uuid NOT NULL REFERENCES obligaciones(id) ON DELETE CASCADE,
  -- Referencia propia. Es la base de la atribución al agente.
  referencia      text NOT NULL,
  monto_centavos  bigint NOT NULL,
  pasarela        text NOT NULL CHECK (pasarela IN ('wompi','epayco','bold')),
  transaccion_id  text,
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','aprobado','declinado','anulado','error')),
  atribuido_al_agente boolean NOT NULL DEFAULT false,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  pagado_en       timestamptz,
  UNIQUE (tenant_id, referencia)
);

-- De dónde sale la cartera. Un conector es config, no código.
CREATE TABLE conectores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo          text NOT NULL
                CHECK (tipo IN ('archivo','google_sheets','postgres','sqlserver','mysql')),
  nombre        text NOT NULL,
  -- Credenciales cifradas. Es acceso a la base de un tercero.
  config_cifrada text,
  consulta      text,
  mapeo         jsonb,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cargas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conector_id  uuid REFERENCES conectores(id) ON DELETE SET NULL,
  origen       text NOT NULL,
  filas_leidas      integer NOT NULL DEFAULT 0,
  filas_aceptadas   integer NOT NULL DEFAULT 0,
  filas_cuarentena  integer NOT NULL DEFAULT 0,
  estado       text NOT NULL DEFAULT 'corriendo'
               CHECK (estado IN ('corriendo','listo','fallido')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- La fila mala va a cuarentena y la carga continúa. Nunca se descarta.
CREATE TABLE filas_cuarentena (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carga_id   uuid NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  fila       jsonb NOT NULL,
  motivo     text NOT NULL
);

CREATE TABLE tenant_usuarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  nombre     text,
  hash_clave text NOT NULL,
  rol        text NOT NULL DEFAULT 'operador' CHECK (rol IN ('operador','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- El UNIQUE evita avisar dos veces por el mismo umbral en el mismo periodo.
CREATE TABLE avisos_cupo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  periodo    text NOT NULL,
  concepto   text NOT NULL CHECK (concepto IN ('conversaciones','plantillas')),
  umbral_pct integer NOT NULL,
  avisado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, periodo, concepto, umbral_pct)
);

-- agent_events sirve a los dos productos. En cobranza `case_id` queda NULL y se
-- usa `conversacion_id`, porque la conversación es la unidad en la que se mide
-- el costo de IA y la unidad que se factura.
ALTER TABLE agent_events
  ADD COLUMN conversacion_id uuid REFERENCES conversaciones(id) ON DELETE CASCADE,
  ADD COLUMN obligacion_id   uuid REFERENCES obligaciones(id) ON DELETE CASCADE;

CREATE INDEX ON deudores      (tenant_id, documento);
CREATE INDEX ON obligaciones  (tenant_id, estado, tramo);
CREATE INDEX ON obligaciones  (tenant_id, deudor_id);
CREATE INDEX ON contactos     (tenant_id, deudor_id, ocurrido_en);
CREATE INDEX ON contactos     (tenant_id, ocurrido_en DESC);
CREATE INDEX ON contactos     (id_proveedor);
CREATE INDEX ON conversaciones (tenant_id, abierta_en DESC);
CREATE INDEX ON agent_events  (tenant_id, conversacion_id);
CREATE INDEX ON pagos         (tenant_id, referencia);

-- RLS. Mismo bloque que la migración de conciliación: la política solo puede
-- restringir, y sin `app.tenant_id` en la sesión no sale ninguna fila.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'deudores','obligaciones','conversaciones','contactos','ventanas_servicio',
    'plantillas','cadencias','cadencia_ejecuciones','acuerdos','pagos',
    'conectores','cargas','filas_cuarentena','tenant_usuarios','avisos_cupo'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;
