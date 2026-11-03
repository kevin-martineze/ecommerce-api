-- ============================================================================
-- Cobro verificado de Wompi: el nombre de la cuenta y el último aviso recibido.
--
-- merchant_name sale de la verificación de la llave al conectar. last_event_at
-- se pone cada vez que un evento de la tienda pasa la firma, para que la
-- dueña vea si la pasarela ya le está avisando. Ambas columnas son opcionales:
-- las cuentas conectadas antes quedan en null hasta su próximo evento.
-- ============================================================================

alter table store_payment_accounts
  add column merchant_name text,
  add column last_event_at timestamptz(6);
