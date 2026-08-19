-- Un hilo de bandeja no es una ventana de facturación.
--
-- `conversaciones` nació mezclando dos ideas que parecen la misma y no lo son:
--
--   el hilo      lo que el asesor ve en la bandeja. Dura mientras el caso siga
--                abierto, sean días o semanas.
--   la ventana   las 24 h que la cotización factura como "una conversación", y
--                que también define si Meta acepta texto libre o exige plantilla.
--
-- La contradicción era concreta y costaba plata: `expira_en` decía que la
-- conversación dura 24 h, el índice único decía "una abierta por deudor mientras
-- `cerrada_en` sea NULL", y nada cerraba por vencimiento. `abrirOReutilizar`
-- reutilizaba un hilo de tres días como si fuera la misma ventana. De las dos
-- definiciones ganaba la que subfactura.
--
-- Se resuelve separándolas: el hilo se queda acá, la ventana vive en
-- `ventanas_servicio`, que ya existía y es contra la que trabajan `abrirVentana`
-- y `estaAbierta` de src/channels/ventana-servicio.ts.
ALTER TABLE conversaciones DROP COLUMN expira_en;

-- Segunda fuente de verdad, y muerta: cero lecturas y cero escrituras en todo
-- el código. El índice único, el índice de bandeja y `abrirOReutilizar` van
-- todos contra `cerrada_en IS NULL`. Una fila con estado='cerrada' y cerrada_en
-- NULL seguía ocupando el slot único y seguía apareciendo en la bandeja.
ALTER TABLE conversaciones DROP COLUMN estado;

-- Los tres uuid que nunca fueron llave foránea, de la misma clase que arregló
-- 20260821000000. `approvals.user_id` llevaba el comentario "Quién movió plata.
-- No texto libre" y era menos que texto libre: no lo validaba nadie.
ALTER TABLE plantillas ADD CONSTRAINT plantillas_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE contactos
  ADD CONSTRAINT contactos_plantilla_fk FOREIGN KEY (tenant_id, plantilla_id)
    REFERENCES plantillas (tenant_id, id) ON DELETE SET NULL (plantilla_id);
ALTER TABLE acuerdos
  ADD CONSTRAINT acuerdos_aprobado_por_fk FOREIGN KEY (tenant_id, aprobado_por)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE SET NULL (aprobado_por);
ALTER TABLE approvals
  ADD CONSTRAINT approvals_usuario_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_usuarios (tenant_id, id) ON DELETE SET NULL (user_id);
