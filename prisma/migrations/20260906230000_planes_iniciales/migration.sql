-- ============================================================================
-- Planes comerciales iniciales.
--
-- Son datos de referencia, no datos de negocio: existen antes que cualquier
-- tienda y toda suscripción apunta a uno. Van en una migración y no en un seed
-- porque `subscriptions.plan_code` es una clave foránea: sin estas filas, el
-- registro de la primera tienda falla.
--
-- `plans` no está bajo RLS —es el mismo catálogo para todos los inquilinos— así
-- que este insert no necesita contexto de tienda.
--
-- Los precios están en pesos enteros. Cambiar uno acá NO cambia lo que paga una
-- tienda ya suscrita: eso es una decisión comercial que se toma tienda por
-- tienda desde el panel de plataforma.
-- ============================================================================

insert into plans (code, name, price_cop, max_products, max_orders_per_month, max_images_per_product, custom_domain, active)
values
	('basico', 'Básico', 49000, 100, 300, 6, false, true),
	('pro', 'Pro', 99000, null, null, 12, true, true)
on conflict (code) do nothing;
