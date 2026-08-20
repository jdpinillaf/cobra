-- La pantalla de Consumo lee `agent_events` por rango de fechas.
--
-- Los índices que había son `(tenant_id, case_id, id)` y
-- `(tenant_id, conversacion_id)`: sirven para la traza de un caso o de un hilo,
-- no para "cuánto consumió este cliente en agosto". Sin este, esa consulta
-- recorre entera la tabla que más rápido crece del sistema — una fila por cada
-- paso de herramienta de cada turno del agente, o sea varias por conversación.
CREATE INDEX ON agent_events (tenant_id, created_at DESC);
