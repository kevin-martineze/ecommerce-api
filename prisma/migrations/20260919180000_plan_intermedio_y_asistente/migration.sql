-- ============================================================================
-- Un plan intermedio, y el asistente como razón para subir de plan.
--
-- `ai_replies_per_month` es la cuota mensual del asistente de la tienda. Cero
-- significa que ese plan no lo incluye, y por eso es un número y no un
-- booleano: el costo del asistente lo pone el tráfico de la tienda, no lo que
-- paga la dueña. Sin tope, una tienda que se vuelve viral se come el margen de
-- veinte.
--
-- Los planes que ya existían se quedan como estaban: Básico sigue sin
-- asistente y Pro lo estrena. Cambiar estos números aquí NO cambia lo que
-- paga ni lo que recibe una tienda ya suscrita hasta su próxima renovación:
-- eso se decide tienda por tienda desde la consola.
-- ============================================================================

alter table plans
	add column ai_replies_per_month integer not null default 0;

insert into plans (code, name, price_cop, max_products, max_orders_per_month, max_images_per_product, custom_domain, active, ai_replies_per_month)
values ('impulso', 'Impulso', 74900, 400, 1000, 10, false, true, 500)
on conflict (code) do nothing;

update plans set ai_replies_per_month = 2000 where code = 'pro';
