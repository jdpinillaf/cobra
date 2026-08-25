-- Una llamada que termina en revocación no es «una promesa».
--
-- El caso apareció en una simulación entre dos modelos: el deudor pidió la baja
-- y la llamada quedó registrada como `promesa`, porque el agente había alcanzado
-- a proponer un acuerdo antes. Leer esa fila y volver a llamar sería
-- exactamente lo que la Ley 2300 prohíbe, así que el resultado tiene que decir
-- que la persona pidió que no la contacten más.
ALTER TABLE llamadas DROP CONSTRAINT llamadas_resultado_check;
ALTER TABLE llamadas ADD CONSTRAINT llamadas_resultado_check
  CHECK (resultado IN ('acuerdo','promesa','sin_acuerdo','numero_errado',
                       'escalado','sin_contacto','baja'));
