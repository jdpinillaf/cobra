-- Llaves foráneas que no se pueden cruzar de tenant.
--
-- El hueco: RLS con WITH CHECK valida el `tenant_id` **de la fila que se
-- inserta**, pero nada obliga a que la fila referenciada sea del mismo tenant.
-- Con las políticas puestas y funcionando, esto pasaba:
--
--   INSERT INTO notas    (tenant_id, conversacion_id, ...) VALUES (A, <conv de B>, ...)
--   INSERT INTO sesiones (tenant_id, usuario_id,      ...) VALUES (A, <user de B>, ...)
--
-- La segunda es la grave: una sesión del tenant A apuntando a un usuario del
-- tenant B es un camino de escalada de privilegios, porque el tenant sale de la
-- sesión y el usuario de otra tabla.
--
-- La solución es estructural, no de código: la llave foránea lleva el tenant
-- adentro. Referenciar a otro tenant deja de ser una regla que hay que recordar
-- y pasa a ser algo que la base rechaza.

-- 1. Cada padre expone (tenant_id, id) como llave referenciable.
ALTER TABLE tenant_usuarios     ADD CONSTRAINT tenant_usuarios_tenant_id_key     UNIQUE (tenant_id, id);
ALTER TABLE deudores            ADD CONSTRAINT deudores_tenant_id_key            UNIQUE (tenant_id, id);
ALTER TABLE obligaciones        ADD CONSTRAINT obligaciones_tenant_id_key        UNIQUE (tenant_id, id);
ALTER TABLE conversaciones      ADD CONSTRAINT conversaciones_tenant_id_key      UNIQUE (tenant_id, id);
ALTER TABLE etiquetas           ADD CONSTRAINT etiquetas_tenant_id_key           UNIQUE (tenant_id, id);
ALTER TABLE conectores          ADD CONSTRAINT conectores_tenant_id_key          UNIQUE (tenant_id, id);
ALTER TABLE cargas              ADD CONSTRAINT cargas_tenant_id_key              UNIQUE (tenant_id, id);
ALTER TABLE cases               ADD CONSTRAINT cases_tenant_id_key               UNIQUE (tenant_id, id);
ALTER TABLE raw_emails          ADD CONSTRAINT raw_emails_tenant_id_key          UNIQUE (tenant_id, id);
ALTER TABLE bank_notifications  ADD CONSTRAINT bank_notifications_tenant_id_key  UNIQUE (tenant_id, id);
ALTER TABLE payment_claims      ADD CONSTRAINT payment_claims_tenant_id_key      UNIQUE (tenant_id, id);
ALTER TABLE reconciliations     ADD CONSTRAINT reconciliations_tenant_id_key     UNIQUE (tenant_id, id);

-- 2. Se reemplaza cada FK simple por una compuesta.
--
-- Ojo con `ON DELETE SET NULL` sobre una llave compuesta: por defecto anula
-- **todas** las columnas de la llave, incluida `tenant_id`, que es NOT NULL.
-- Borrar un usuario intentaría dejar la conversación sin tenant y reventaría.
-- Por eso va acotado a la columna que corresponde, que Postgres 15+ permite.
--
-- Se conserva el ON DELETE de la original en cada caso: perderlo convertiría un
-- borrado en cascada en un error de integridad la primera vez que alguien borre
-- un tenant.

-- Cobranza
ALTER TABLE obligaciones DROP CONSTRAINT obligaciones_deudor_id_fkey,
  ADD CONSTRAINT obligaciones_deudor_fk FOREIGN KEY (tenant_id, deudor_id)
    REFERENCES deudores (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE conversaciones DROP CONSTRAINT conversaciones_deudor_id_fkey,
  ADD CONSTRAINT conversaciones_deudor_fk FOREIGN KEY (tenant_id, deudor_id)
    REFERENCES deudores (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE conversaciones DROP CONSTRAINT conversaciones_obligacion_id_fkey,
  ADD CONSTRAINT conversaciones_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE SET NULL (obligacion_id);
ALTER TABLE conversaciones DROP CONSTRAINT conversaciones_pausada_por_fkey,
  ADD CONSTRAINT conversaciones_pausada_por_fk FOREIGN KEY (tenant_id, pausada_por)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE SET NULL (pausada_por);
ALTER TABLE conversaciones DROP CONSTRAINT conversaciones_asignada_a_fkey,
  ADD CONSTRAINT conversaciones_asignada_a_fk FOREIGN KEY (tenant_id, asignada_a)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE SET NULL (asignada_a);

ALTER TABLE contactos DROP CONSTRAINT contactos_obligacion_id_fkey,
  ADD CONSTRAINT contactos_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contactos DROP CONSTRAINT contactos_deudor_id_fkey,
  ADD CONSTRAINT contactos_deudor_fk FOREIGN KEY (tenant_id, deudor_id)
    REFERENCES deudores (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE contactos DROP CONSTRAINT contactos_conversacion_id_fkey,
  ADD CONSTRAINT contactos_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE SET NULL (conversacion_id);

ALTER TABLE ventanas_servicio DROP CONSTRAINT ventanas_servicio_deudor_id_fkey,
  ADD CONSTRAINT ventanas_servicio_deudor_fk FOREIGN KEY (tenant_id, deudor_id)
    REFERENCES deudores (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE cadencia_ejecuciones DROP CONSTRAINT cadencia_ejecuciones_obligacion_id_fkey,
  ADD CONSTRAINT cadencia_ejecuciones_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE acuerdos DROP CONSTRAINT acuerdos_obligacion_id_fkey,
  ADD CONSTRAINT acuerdos_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE pagos DROP CONSTRAINT pagos_obligacion_id_fkey,
  ADD CONSTRAINT pagos_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE cargas DROP CONSTRAINT cargas_conector_id_fkey,
  ADD CONSTRAINT cargas_conector_fk FOREIGN KEY (tenant_id, conector_id)
    REFERENCES conectores (tenant_id, id) ON DELETE SET NULL (conector_id);

ALTER TABLE filas_cuarentena DROP CONSTRAINT filas_cuarentena_carga_id_fkey,
  ADD CONSTRAINT filas_cuarentena_carga_fk FOREIGN KEY (tenant_id, carga_id)
    REFERENCES cargas (tenant_id, id) ON DELETE CASCADE;

-- Bandeja
ALTER TABLE notas DROP CONSTRAINT notas_conversacion_id_fkey,
  ADD CONSTRAINT notas_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE notas DROP CONSTRAINT notas_usuario_id_fkey,
  ADD CONSTRAINT notas_usuario_fk FOREIGN KEY (tenant_id, usuario_id)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE SET NULL (usuario_id);

ALTER TABLE conversacion_etiquetas DROP CONSTRAINT conversacion_etiquetas_conversacion_id_fkey,
  ADD CONSTRAINT conversacion_etiquetas_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE conversacion_etiquetas DROP CONSTRAINT conversacion_etiquetas_etiqueta_id_fkey,
  ADD CONSTRAINT conversacion_etiquetas_etiqueta_fk FOREIGN KEY (tenant_id, etiqueta_id)
    REFERENCES etiquetas (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE lecturas DROP CONSTRAINT lecturas_conversacion_id_fkey,
  ADD CONSTRAINT lecturas_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE lecturas DROP CONSTRAINT lecturas_usuario_id_fkey,
  ADD CONSTRAINT lecturas_usuario_fk FOREIGN KEY (tenant_id, usuario_id)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_usuario_id_fkey,
  ADD CONSTRAINT notificaciones_usuario_fk FOREIGN KEY (tenant_id, usuario_id)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_conversacion_id_fkey,
  ADD CONSTRAINT notificaciones_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE sesiones DROP CONSTRAINT sesiones_usuario_id_fkey,
  ADD CONSTRAINT sesiones_usuario_fk FOREIGN KEY (tenant_id, usuario_id)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE CASCADE;

-- Conciliación
ALTER TABLE bank_notifications DROP CONSTRAINT bank_notifications_raw_email_id_fkey,
  ADD CONSTRAINT bank_notifications_raw_email_fk FOREIGN KEY (tenant_id, raw_email_id)
    REFERENCES raw_emails (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE payment_claims DROP CONSTRAINT payment_claims_case_id_fkey,
  ADD CONSTRAINT payment_claims_case_fk FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id) ON DELETE SET NULL (case_id);

ALTER TABLE reconciliations DROP CONSTRAINT reconciliations_case_id_fkey,
  ADD CONSTRAINT reconciliations_case_fk FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE reconciliations DROP CONSTRAINT reconciliations_claim_id_fkey,
  ADD CONSTRAINT reconciliations_claim_fk FOREIGN KEY (tenant_id, claim_id)
    REFERENCES payment_claims (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE reconciliations DROP CONSTRAINT reconciliations_notification_id_fkey,
  ADD CONSTRAINT reconciliations_notification_fk FOREIGN KEY (tenant_id, notification_id)
    REFERENCES bank_notifications (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE approvals DROP CONSTRAINT approvals_reconciliation_id_fkey,
  ADD CONSTRAINT approvals_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id)
    REFERENCES reconciliations (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE agent_events DROP CONSTRAINT agent_events_case_id_fkey,
  ADD CONSTRAINT agent_events_case_fk FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE agent_events DROP CONSTRAINT agent_events_conversacion_id_fkey,
  ADD CONSTRAINT agent_events_conversacion_fk FOREIGN KEY (tenant_id, conversacion_id)
    REFERENCES conversaciones (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE agent_events DROP CONSTRAINT agent_events_obligacion_id_fkey,
  ADD CONSTRAINT agent_events_obligacion_fk FOREIGN KEY (tenant_id, obligacion_id)
    REFERENCES obligaciones (tenant_id, id) ON DELETE CASCADE;
