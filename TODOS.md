# TODOS

Trabajo diferido conscientemente, con el porqué. Un TODO sin contexto es peor que
ningún TODO: da la sensación de que la idea quedó capturada mientras el razonamiento
se perdió.

Origen: `/plan-eng-review` sobre `ponox-plan-tecnico.md`, 2026-08-18.

---

## 1. Heartbeat de ingesta de correo

**Qué:** Cron diario por tenant. Si no llega ningún `raw_email` en 48 horas hábiles,
alertar al dueño y al comerciante: "no estamos recibiendo tus notificaciones de
Bancolombia".

**Por qué:** Es el único hueco crítico que dejó abierto el eng review. El modo de falla
más probable de todo el producto (el cliente borra el filtro de Gmail, Google cambia
algo, la cuenta se llena) es también el único invisible. El sistema no distingue
"hoy no hubo pagos" de "hace tres días que no llega nada". Un cliente puede estar
sin conciliar una semana entera y enterarse por sus propios clientes furiosos.

**Pros:** Convierte la falla silenciosa en una falla ruidosa. Es el mismo argumento
del §6 del plan sobre el riesgo de banco único: la detección temprana no es una
mejora, es el sistema. Además da una razón permanente para la pantalla de
verificación en vivo, que hoy solo existe para el onboarding.

**Contras:** Falsos positivos en negocios con días muertos reales (un local que cierra
lunes y martes). Necesita conocer el calendario del comerciante o un umbral por tenant.

**Contexto:** El plan revisado lo documenta en §14 junto con los otros dos detectores
(`raw_emails` sin parsear, y volumen anómalo en cuarentena). La infraestructura ya
está: `src/compliance/festivos.ts` sabe de días hábiles colombianos, y la alerta va
por WhatsApp con `ProveedorMetaCloud`, el mismo canal que ya se usa para todo lo demás.

**Depende de:** tabla `raw_emails` poblada, canal de alertas definido (§5 del plan),
`src/compliance/festivos.ts`.

---

## 2. Miniatura redactada de comprobantes

**Qué:** En vez de exponer el comprobante original en una URL pública para que
`=IMAGE()` lo muestre en el Sheet, generar una miniatura con solo monto y fecha, y
dejar el original detrás de la sesión de la consola.

**Por qué:** Riesgo aceptado en la revisión (§10 del plan). Hoy los comprobantes
(nombres, montos, números de cuenta de terceros) viven en URLs públicas indefinidas
protegidas solo por una clave larga, y Google los descarga y cachea. Contradice el
argumento de venta del §5, que promete guardar menos datos sensibles. Se aceptó a
cambio de conservar la miniatura dentro del Sheet, que es lo que impresiona en la demo.

**Pros:** Ningún documento financiero de terceros queda público. Conserva el efecto
visual del Sheet. Mejor posición si un cliente pregunta por seguridad, o frente a
Ley 1581.

**Contras:** Un paso de generación de imagen que hoy no existe. Hay que decidir qué
se redacta y qué no, y las miniaturas también ocupan Storage.

**Contexto:** Retomar si cambia el criterio, si un cliente pregunta, o cuando se
publique la política de tratamiento de datos. Mientras tanto rigen las tres
mitigaciones del §10: clave de ≥32 bytes, `X-Robots-Tag: noindex` en el bucket, y
borrado del objeto a los N días de cerrado el caso. **Esas tres sí van en v1.**

**Depende de:** Supabase Storage funcionando, consola con sesión.

---

## 3. Backups y recuperación

**Qué:** `pg_dump` nocturno a Storage, o subir a Supabase Pro por point-in-time
recovery.

**Por qué:** Supabase free no tiene PITR. La historia de conciliación de un cliente
es lo único verdaderamente irreemplazable del sistema: los correos del banco no se
pueden volver a pedir, los comprobantes de WhatsApp tampoco, y `agent_events` es
append-only por diseño precisamente porque es la evidencia de qué se decidió y por qué.

**Pros:** Un borrado accidental o una migración mal hecha dejan de ser terminales.
A este volumen el dump es de megabytes.

**Contras:** Un backup con datos financieros de terceros es otro lugar donde esos
datos existen. Hay que cifrarlo y ponerle retención, o el backup se vuelve el
problema que intentaba evitar.

**Depende de:** decidir antes si Ponox se queda en Supabase free o pasa a Pro. La
respuesta probablemente llegue sola con el primer cliente pagando.

---

## 4. Llamadas que quedan en `en_curso` para siempre

**Qué:** un barrido que cierre las llamadas cuya escritura de cierre nunca llegó
—`estado = 'en_curso'` y `iniciada_en` de hace más de una hora— marcándolas como
`fallida`, y un `motivo_fin` que diga que se perdió el cierre.

**Por qué:** apareció corriendo el set de demo: se cayó el DNS de Supabase a
mitad de una llamada y la fila quedó `en_curso`, sin duración, sin resumen y sin
costo. La pantalla la muestra como si todavía estuviera hablando. Con Twilio de
verdad va a pasar más seguido, porque ahí el proceso también puede morir con el
socket abierto.

**Pros:** son diez líneas dentro de `/api/cron/tick`, que ya recorre los tenants
activos. Y sin esto el costo del mes queda subestimado: una llamada sin cerrar
es una llamada sin costo.

**Contras:** cerrar por tiempo es adivinar. Una llamada larga de verdad no
debería marcarse como fallida, así que el umbral tiene que ser holgado —una hora
es mucho más que cualquier llamada de cobranza real.

**Depende de:** nada. Se puede hacer apenas haya una llamada real que lo
justifique.
