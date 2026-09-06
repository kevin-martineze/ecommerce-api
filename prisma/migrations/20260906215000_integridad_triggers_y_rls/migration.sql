-- ============================================================================
-- Reglas que Prisma no sabe expresar: CHECK, triggers de coherencia, RLS y
-- permisos del rol de aplicación.
--
-- Esta migración se escribe a mano. No se deriva del schema y `prisma migrate`
-- no la va a regenerar: si se borra, la base queda sintácticamente igual y
-- funcionalmente indefensa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Restricciones de integridad
--
-- Van en la base y no solo en los DTO porque un DTO protege una ruta, y una
-- restricción protege el dato. Cualquier camino que no haya pasado por el DTO
-- —un script de migración, una corrección a mano, un endpoint nuevo mal
-- escrito— choca igual contra esto.
-- ----------------------------------------------------------------------------

-- El slug de la tienda termina siendo un nombre de host. Un punto o una
-- mayúscula ahí no es un dato feo: es un subdominio que no resuelve.
alter table stores add constraint stores_slug_format
	check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

alter table stores add constraint stores_next_order_number_positive
	check (next_order_number > 0);

alter table colors add constraint colors_hex_format
	check (hex ~ '^#[0-9a-fA-F]{6}$');

-- El código se compara tal cual, así que "verano10" nunca debe poder entrar y
-- luego fallar contra "VERANO10".
alter table coupons add constraint coupons_code_upper check (code = upper(code));
alter table coupons add constraint coupons_value_positive check (value > 0);
alter table coupons add constraint coupons_min_subtotal_non_negative check (min_subtotal >= 0);
alter table coupons add constraint coupons_max_uses_positive check (max_uses is null or max_uses > 0);
alter table coupons add constraint coupons_uses_non_negative check (uses >= 0);
alter table coupons add constraint coupons_percent_range
	check (type <> 'percent' or value between 1 and 100);
alter table coupons add constraint coupons_window_ordered
	check (starts_at is null or ends_at is null or starts_at < ends_at);

alter table products add constraint products_base_price_non_negative check (base_price >= 0);
alter table products add constraint products_compare_at_non_negative
	check (compare_at_price is null or compare_at_price >= 0);

alter table variants add constraint variants_stock_non_negative check (stock >= 0);
alter table variants add constraint variants_price_override_non_negative
	check (price_override is null or price_override >= 0);

alter table shipping_zones add constraint shipping_zones_cost_non_negative check (cost >= 0);
alter table shipping_zones add constraint shipping_zones_eta_non_negative
	check (eta_days is null or eta_days >= 0);

alter table store_settings add constraint store_settings_threshold_non_negative
	check (free_shipping_threshold is null or free_shipping_threshold >= 0);

alter table collection_products add constraint collection_products_hotspot_x_range
	check (hotspot_x is null or hotspot_x between 0 and 100);
alter table collection_products add constraint collection_products_hotspot_y_range
	check (hotspot_y is null or hotspot_y between 0 and 100);

alter table orders add constraint orders_number_positive check (number > 0);
alter table orders add constraint orders_subtotal_non_negative check (subtotal >= 0);
alter table orders add constraint orders_discount_non_negative check (discount >= 0);
alter table orders add constraint orders_shipping_non_negative check (shipping_cost >= 0);
alter table orders add constraint orders_total_non_negative check (total >= 0);

-- El total no es un campo libre: es la suma. Que la base lo verifique impide
-- que un bug de cálculo deje un pedido que no cuadra con sus propias cifras.
alter table orders add constraint orders_total_matches_breakdown
	check (total = subtotal - discount + shipping_cost);

alter table orders add constraint orders_discount_within_subtotal
	check (discount <= subtotal);

alter table order_items add constraint order_items_unit_price_non_negative check (unit_price >= 0);
alter table order_items add constraint order_items_qty_positive check (qty > 0);
alter table order_items add constraint order_items_line_total_matches
	check (line_total = unit_price * qty);

alter table payments add constraint payments_amount_positive check (amount_cop > 0);
alter table payments add constraint payments_period_ordered check (period_start <= period_end);

alter table plans add constraint plans_price_non_negative check (price_cop >= 0);

-- ----------------------------------------------------------------------------
-- 2. Coherencia del `store_id` denormalizado
--
-- Las tablas que cuelgan de otra llevan `store_id` propio para que las
-- políticas de RLS sean una comparación y no un `exists` anidado. El precio de
-- esa decisión es que la columna podría desincronizarse del padre.
--
-- Este trigger elimina el riesgo: en vez de VALIDAR lo que mandó el llamador,
-- lo DERIVA del padre y lo sobrescribe. Así el `store_id` de una imagen es, por
-- construcción, el de su producto — no hay forma de escribir uno distinto ni
-- por error ni a propósito.
-- ----------------------------------------------------------------------------

create or replace function derive_store_id_from_parent() returns trigger
language plpgsql
as $fn$
declare
	v_parent_table text := tg_argv[0];
	v_parent_column text := tg_argv[1];
	v_parent_id uuid;
	v_store uuid;
begin
	-- `to_jsonb` evita construir dinámicamente el acceso al campo del registro,
	-- que en plpgsql exige EXECUTE y es más fácil de escribir mal.
	v_parent_id := (to_jsonb(new) ->> v_parent_column)::uuid;

	if v_parent_id is null then
		raise exception 'La columna % viene en null; no se puede derivar la tienda', v_parent_column;
	end if;

	execute format('select store_id from %I where id = $1', v_parent_table)
		into v_store
		using v_parent_id;

	if v_store is null then
		raise exception 'No existe % con id %', v_parent_table, v_parent_id;
	end if;

	new.store_id := v_store;

	return new;
end;
$fn$;

create trigger product_images_store_id before insert or update on product_images
	for each row execute function derive_store_id_from_parent('products', 'product_id');

create trigger variants_store_id before insert or update on variants
	for each row execute function derive_store_id_from_parent('products', 'product_id');

create trigger collection_products_store_id before insert or update on collection_products
	for each row execute function derive_store_id_from_parent('collections', 'collection_id');

create trigger order_items_store_id before insert or update on order_items
	for each row execute function derive_store_id_from_parent('orders', 'order_id');

create trigger restock_requests_store_id before insert or update on restock_requests
	for each row execute function derive_store_id_from_parent('variants', 'variant_id');

-- ----------------------------------------------------------------------------
-- 3. Row Level Security
--
-- La aplicación se conecta con `tienda_app`, que no es dueño de estas tablas y
-- no tiene BYPASSRLS, así que estas políticas se le aplican de verdad.
--
-- La expresión clave es:
--
--     store_id = nullif(current_setting('app.store_id', true), '')::uuid
--
-- Si nadie fijó el inquilino, `current_setting(..., true)` devuelve NULL, la
-- comparación da NULL, y NULL no es TRUE: la consulta ve CERO filas. Es
-- deliberado que el caso "me olvidé de abrir el contexto" no devuelva nada, en
-- lugar de devolverlo todo.
--
-- Quién fija ese valor: `PrismaService.forStore`, con `set_config(..., true)`
-- local a la transacción. Ver src/prisma/prisma.service.ts.
--
-- Tablas SIN RLS, a propósito, porque no pertenecen a ningún inquilino y hay
-- que poder leerlas ANTES de saber de qué tienda hablamos:
--
--   users, refresh_tokens, platform_admins   el login busca por correo antes de
--                                            que exista contexto de tienda
--   stores                                   la tienda pública se resuelve por
--                                            slug o dominio, que es justo el
--                                            paso que determina el contexto
--   store_members                            el guard la consulta para DECIDIR
--                                            si hay acceso; si dependiera del
--                                            contexto sería circular
--   plans                                    catálogo comercial, igual para todos
-- ----------------------------------------------------------------------------

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
		execute format('alter table %I enable row level security', t);

		-- `force` para que la política se aplique también al dueño de la tabla.
		-- Sin esto, cualquier conexión con el rol dueño —una migración, un
		-- script de mantenimiento, alguien depurando— trabaja sin red y no se
		-- entera.
		execute format('alter table %I force row level security', t);

		execute format(
			$policy$
				create policy %I on %I for all to tienda_app
				using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
				with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
			$policy$,
			t || '_tenant_isolation', t
		);
	end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Permisos del rol de aplicación
--
-- RLS decide QUÉ FILAS ve cada rol, pero primero hace falta el permiso sobre la
-- tabla: sin GRANT, Postgres responde "permission denied" antes siquiera de
-- evaluar las políticas.
--
-- `tienda_app` no recibe permisos sobre `_prisma_migrations`: las migraciones
-- las corre el rol dueño con DIRECT_URL, y la aplicación no tiene por qué poder
-- tocar su propio historial.
-- ----------------------------------------------------------------------------

grant usage on schema public to tienda_app;

do $$
declare
	t text;
begin
	for t in
		select tablename from pg_tables
		where schemaname = 'public' and tablename <> '_prisma_migrations'
	loop
		execute format('grant select, insert, update, delete on table %I to tienda_app', t);
	end loop;
end;
$$;

-- Las tablas que se creen en migraciones futuras heredan lo mismo, para que
-- nadie tenga que acordarse de este archivo.
alter default privileges in schema public
	grant select, insert, update, delete on tables to tienda_app;
