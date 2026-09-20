-- ============================================================================
-- Que una tienda pueda vender cualquier cosa, no solo ropa.
--
-- El modelo anterior obligaba a que TODA variante fuera exactamente
-- (color, talla): las dos columnas eran NOT NULL y la unicidad se apoyaba en
-- ellas. Con eso, vender un libro exigía inventarle un color "Único" y una
-- talla "Única", y vender café —origen, molienda, peso— era imposible: solo
-- había dos casillas.
--
-- Ahora cada PRODUCTO declara sus ejes. Una tienda de ropa declara Color y
-- Talla; una librería, Formato; una tostadora, Molienda y Peso; un producto
-- sin ejes tiene una sola variante y ya.
--
-- Nada se pierde: los colores y tallas que hoy existen se convierten en
-- opciones del producto que los usaba, con su nombre, su hex y su orden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las tablas nuevas
-- ----------------------------------------------------------------------------

create table product_options (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	product_id uuid not null references products (id) on delete cascade,
	name text not null,
	sort_order integer not null default 0,
	constraint product_options_name_not_blank check (length(btrim(name)) > 0)
);

create unique index product_options_product_id_name_key on product_options (product_id, name);
create index product_options_store_id_idx on product_options (store_id);

create table product_option_values (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	option_id uuid not null references product_options (id) on delete cascade,
	value text not null,
	hex text,
	sort_order integer not null default 0,
	constraint product_option_values_value_not_blank check (length(btrim(value)) > 0),
	-- El formato del color lo verifica la base, no solo el DTO: es lo que
	-- impide que un `#gg0000` llegue a un atributo de estilo. Acepta mayúsculas
	-- porque así lo hacía la tabla `colors` de la que vienen estos valores.
	constraint product_option_values_hex_format check (hex is null or hex ~ '^#[0-9a-fA-F]{6}$')
);

create unique index product_option_values_option_id_value_key on product_option_values (option_id, value);
create index product_option_values_store_id_idx on product_option_values (store_id);

create table product_attributes (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	product_id uuid not null references products (id) on delete cascade,
	name text not null,
	value text not null,
	sort_order integer not null default 0,
	constraint product_attributes_name_not_blank check (length(btrim(name)) > 0)
);

create unique index product_attributes_product_id_name_key on product_attributes (product_id, name);
create index product_attributes_store_id_idx on product_attributes (store_id);

create table variant_option_values (
	store_id uuid not null references stores (id) on delete cascade,
	variant_id uuid not null references variants (id) on delete cascade,
	-- `restrict`: borrar un valor que alguna variante usa tiene que fallar, no
	-- dejar la variante a medias sin uno de sus ejes.
	option_value_id uuid not null references product_option_values (id) on delete restrict,
	primary key (variant_id, option_value_id)
);

create index variant_option_values_option_value_id_idx on variant_option_values (option_value_id);
create index variant_option_values_store_id_idx on variant_option_values (store_id);

-- El `store_id` denormalizado lo pone la base, derivándolo del padre, igual
-- que en las demás tablas hijas.
create trigger product_options_store_id before insert or update on product_options
	for each row execute function derive_store_id_from_parent('products', 'product_id');

create trigger product_option_values_store_id before insert or update on product_option_values
	for each row execute function derive_store_id_from_parent('product_options', 'option_id');

create trigger product_attributes_store_id before insert or update on product_attributes
	for each row execute function derive_store_id_from_parent('products', 'product_id');

create trigger variant_option_values_store_id before insert or update on variant_option_values
	for each row execute function derive_store_id_from_parent('variants', 'variant_id');

alter table product_options enable row level security;
alter table product_options force row level security;
alter table product_option_values enable row level security;
alter table product_option_values force row level security;
alter table product_attributes enable row level security;
alter table product_attributes force row level security;
alter table variant_option_values enable row level security;
alter table variant_option_values force row level security;

create policy product_options_tenant_isolation on product_options for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

create policy product_option_values_tenant_isolation on product_option_values for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

create policy product_attributes_tenant_isolation on product_attributes for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

create policy variant_option_values_tenant_isolation on variant_option_values for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

grant select, insert, update, delete on product_options to tienda_app;
grant select, insert, update, delete on product_option_values to tienda_app;
grant select, insert, update, delete on product_attributes to tienda_app;
grant select, insert, update, delete on variant_option_values to tienda_app;

-- ----------------------------------------------------------------------------
-- 2. Los datos que ya existen
--
-- Cada producto con variantes gana dos opciones —Color y Talla— con los
-- valores que de verdad usaba, no con el catálogo entero de la tienda: si un
-- vestido solo venía en negro, su opción Color tiene un valor, no doce.
--
-- El enlace se hace por NOMBRE y no por id: si dos colores distintos se
-- llamaban igual, colapsan en un valor, que es lo correcto — para la clienta
-- siempre fueron el mismo.
-- ----------------------------------------------------------------------------

insert into product_options (id, store_id, product_id, name, sort_order)
select gen_random_uuid(), p.store_id, p.id, 'Color', 0
from products p
where exists (select 1 from variants v where v.product_id = p.id);

insert into product_options (id, store_id, product_id, name, sort_order)
select gen_random_uuid(), p.store_id, p.id, 'Talla', 1
from products p
where exists (select 1 from variants v where v.product_id = p.id);

insert into product_option_values (id, store_id, option_id, value, hex, sort_order)
select distinct on (po.id, c.name)
	gen_random_uuid(), po.store_id, po.id, c.name, c.hex, c.sort_order
from product_options po
join variants v on v.product_id = po.product_id
join colors c on c.id = v.color_id
where po.name = 'Color'
order by po.id, c.name, c.sort_order;

insert into product_option_values (id, store_id, option_id, value, hex, sort_order)
select distinct on (po.id, s.label)
	gen_random_uuid(), po.store_id, po.id, s.label, null, s.sort_order
from product_options po
join variants v on v.product_id = po.product_id
join sizes s on s.id = v.size_id
where po.name = 'Talla'
order by po.id, s.label, s.sort_order;

insert into variant_option_values (store_id, variant_id, option_value_id)
select v.store_id, v.id, pov.id
from variants v
join colors c on c.id = v.color_id
join product_options po on po.product_id = v.product_id and po.name = 'Color'
join product_option_values pov on pov.option_id = po.id and pov.value = c.name;

insert into variant_option_values (store_id, variant_id, option_value_id)
select v.store_id, v.id, pov.id
from variants v
join sizes s on s.id = v.size_id
join product_options po on po.product_id = v.product_id and po.name = 'Talla'
join product_option_values pov on pov.option_id = po.id and pov.value = s.label;

-- La foto que era "de este color" pasa a ser "de este valor".
alter table product_images add column option_value_id uuid;

update product_images pi
set option_value_id = pov.id
from colors c
join product_options po on po.name = 'Color'
join product_option_values pov on pov.option_id = po.id and pov.value = c.name
where c.id = pi.color_id
	and po.product_id = pi.product_id;

alter table product_images
	add constraint product_images_option_value_id_fkey
	foreign key (option_value_id) references product_option_values (id) on delete set null;

alter table product_images drop column color_id;

-- Los datos que solo le servían a la ropa pasan a atributos libres.
insert into product_attributes (id, store_id, product_id, name, value, sort_order)
select gen_random_uuid(), p.store_id, p.id, 'Material', btrim(p.material), 0
from products p
where p.material is not null and length(btrim(p.material)) > 0;

insert into product_attributes (id, store_id, product_id, name, value, sort_order)
select gen_random_uuid(), p.store_id, p.id, 'Cuidados', btrim(p.care), 1
from products p
where p.care is not null and length(btrim(p.care)) > 0;

alter table products drop column material, drop column care;

-- ----------------------------------------------------------------------------
-- 3. La variante deja de saber de color y talla
--
-- `options_key` es lo que permite a la base seguir prohibiendo dos variantes
-- con la misma combinación. Con los valores en una tabla puente, un UNIQUE
-- normal ya no puede expresarlo.
-- ----------------------------------------------------------------------------

alter table variants add column options_key text not null default '';

update variants v
set options_key = coalesce((
	select string_agg(vov.option_value_id::text, ',' order by vov.option_value_id)
	from variant_option_values vov
	where vov.variant_id = v.id
), '');

alter table variants alter column options_key drop default;

drop index variants_product_id_color_id_size_id_key;

create unique index variants_product_id_options_key_key on variants (product_id, options_key);

alter table variants drop column color_id, drop column size_id;

-- ----------------------------------------------------------------------------
-- 4. El pedido guarda cómo se llamaba la variante, no sus dos ejes
-- ----------------------------------------------------------------------------

alter table order_items add column variant_label text not null default '';

update order_items
set variant_label = concat_ws(' · ', nullif(btrim(color_name), ''), nullif(btrim(size_label), ''));

alter table order_items alter column variant_label drop default;
alter table order_items drop column color_name, drop column size_label;

-- ----------------------------------------------------------------------------
-- 5. Fuera los catálogos globales
-- ----------------------------------------------------------------------------

drop table colors;
drop table sizes;
