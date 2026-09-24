-- El medio de pago con que se cobra la suscripción sin nadie delante.
--
-- Solo el identificador que devuelve la pasarela, más la marca y los cuatro
-- últimos para poder decir con qué se cobra. La tarjeta nunca pasa por acá:
-- el navegador se la entrega a la pasarela y lo único que llega es un token
-- de un solo uso, que se cambia por esta fuente de pago y se descarta.

alter table "subscriptions"
  add column "payment_source_id" text,
  add column "payment_brand" text,
  add column "payment_last4" text,
  add column "charge_failures" integer not null default 0,
  add column "last_charge_at" timestamp(3);

-- Los cuatro últimos son cuatro dígitos. Un campo libre acá termina guardando
-- la tarjeta entera el día que alguien se equivoque de variable.
alter table "subscriptions"
  add constraint "subscriptions_payment_last4_check"
  check ("payment_last4" is null or "payment_last4" ~ '^[0-9]{4}$');
