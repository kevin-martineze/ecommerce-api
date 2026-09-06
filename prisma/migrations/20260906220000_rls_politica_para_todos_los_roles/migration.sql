-- ============================================================================
-- Corrección de las políticas de aislamiento: pasan de `to tienda_app` a
-- `to public`.
--
-- Qué estaba mal
-- --------------
-- La migración anterior hace dos cosas que juntas se contradicen:
--
--   alter table X force row level security;   -- alcanza también al dueño
--   create policy ... for all to tienda_app;  -- pero solo autoriza a un rol
--
-- `force` somete al dueño de la tabla a las políticas. Como la única política
-- existente estaba restringida a `tienda_app`, el dueño quedaba sometido a RLS
-- y sin ninguna política que lo autorizara: acceso a cero filas, y ni siquiera
-- por una regla de negocio, sino por omisión.
--
-- En local no se nota, porque el rol de las migraciones es `postgres`, que es
-- superusuario y se salta RLS siempre. En un Postgres gestionado —Neon, RDS,
-- Supabase— el rol dueño NO es superusuario, y ahí cualquier migración que
-- toque datos habría fallado con un mensaje que no señala la causa.
--
-- Por qué `to public` y no quitar `force`
-- --------------------------------------
-- `force` cubre el error más caro y más fácil de cometer de toda esta
-- arquitectura: apuntar DATABASE_URL al rol de las migraciones. Sin `force`,
-- esa confusión desactiva el aislamiento entre tiendas en silencio y la
-- aplicación sigue respondiendo con normalidad, sirviendo datos cruzados. Vale
-- la pena conservarlo.
--
-- La política `to public` es el par que le faltaba: la misma regla para todos
-- los roles, incluido el dueño. Nadie queda sin política, y nadie queda sin
-- aislamiento.
--
-- Consecuencia operativa, deliberada
-- ----------------------------------
-- Una migración de datos que cruce varias tiendas ahora tiene que fijar
-- `app.store_id` por cada una, o quitar el `force` de forma explícita y
-- temporal. Es fricción a propósito: escribir sobre varios inquilinos a la vez
-- debería costar una línea que se vea en la revisión del código.
-- ============================================================================

do $$
declare
	t text;
begin
	foreach t in array array[
		'store_settings', 'subscriptions', 'payments',
		'categories', 'colors', 'sizes',
		'products', 'product_images', 'variants',
		'collections', 'collection_products', 'home_highlights',
		'coupons', 'shipping_zones',
		'orders', 'order_items', 'restock_requests'
	] loop
		execute format('drop policy if exists %I on %I', t || '_tenant_isolation', t);

		execute format(
			$policy$
				create policy %I on %I for all to public
				using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
				with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
			$policy$,
			t || '_tenant_isolation', t
		);
	end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Mantenimiento
--
-- Al agregar una tabla que pertenezca a una tienda, NO basta con declararla en
-- schema.prisma: hay que darle su política en una migración propia, con esta
-- misma expresión.
--
-- Los permisos sí los hereda sola, por el ALTER DEFAULT PRIVILEGES de la
-- migración anterior. Esa asimetría es justamente la trampa: la tabla nueva va
-- a funcionar perfecto en las pruebas y no va a estar aislada.
--
-- La red que convierte ese olvido en un build rojo es el test de aislamiento,
-- que recorre las tablas con columna store_id y falla si alguna no tiene
-- política.
-- ----------------------------------------------------------------------------
