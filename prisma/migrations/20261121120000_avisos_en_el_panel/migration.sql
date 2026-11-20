-- ============================================================================
-- Avisos: la bandeja del panel de cada tienda y la de la consola.
--
-- Una fila por destinataria, no por evento: lo leído es de cada persona, y el
-- contador de no leídos sale del índice de la bandeja sin unirse a nada.
--
-- Dos tablas y no una con store_id nulo. Los avisos de tienda van bajo RLS como
-- todo lo que cuelga de una tienda. Los de plataforma hablan de muchas
-- tiendas: dentro de la tabla de tienda con store_id nulo quedarían invisibles
-- para la política, o exigirían una política de "plataforma ve todo", que es
-- el agujero que RLS existe para no tener.
--
-- `data` lleva solo ids, números y nombres de la tienda, nunca datos de una
-- clienta. La forma la valida la API al escribir y al leer.
-- ============================================================================

create type store_notification_type as enum ('ORDER_PLACED', 'ORDER_PAID');

create type platform_notification_type as enum (
	'STORE_CREATED',
	'USER_REGISTERED',
	'SUBSCRIPTION_PAID',
	'SUBSCRIPTION_FAILED',
	'SUPPORT_TICKET_OPENED',
	'SUPPORT_OWNER_REPLIED'
);

create table store_notifications (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	user_id uuid not null references users (id) on delete cascade,
	type store_notification_type not null,
	data jsonb not null check (jsonb_typeof(data) = 'object'),
	read_at timestamptz,
	created_at timestamptz not null default now()
);

-- La bandeja de una persona en una tienda, de la más nueva a la más vieja.
-- El id desempata dos avisos del mismo instante, para que la paginación por
-- cursor no salte ni repita filas.
create index store_notifications_inbox_idx on store_notifications (store_id, user_id, created_at desc, id desc);

create table platform_notifications (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users (id) on delete cascade,
	type platform_notification_type not null,
	data jsonb not null check (jsonb_typeof(data) = 'object'),
	read_at timestamptz,
	created_at timestamptz not null default now()
);

create index platform_notifications_inbox_idx on platform_notifications (user_id, created_at desc, id desc);

-- Política igual a la de todo lo que cuelga de una tienda.
alter table store_notifications enable row level security;
alter table store_notifications force row level security;

create policy store_notifications_tenant_isolation on store_notifications for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

-- Sin update: un aviso no cambia después de creado, solo se marca leído.
grant select, insert, delete on store_notifications to tienda_app;
grant update (read_at) on store_notifications to tienda_app;

grant select, insert, delete on platform_notifications to tienda_app;
grant update (read_at) on platform_notifications to tienda_app;
