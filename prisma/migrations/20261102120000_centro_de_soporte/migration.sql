-- ============================================================================
-- Centro de soporte: el canal entre cada tienda y el equipo de Globerce.
--
-- Un ticket es un caso de la tienda; sus mensajes son el hilo. Los dos cuelgan
-- de la tienda, así que van bajo RLS con la misma política que el resto.
--
-- Los "sin leer" no tienen columna: cada lado guarda cuándo abrió el ticket
-- por última vez (owner_last_read_at / team_last_read_at) y se cuentan los
-- mensajes del otro lado posteriores a esa fecha.
--
-- store_id va repetido en support_messages para que la política compare sin
-- unirse al ticket. La FK compuesta (ticket_id, store_id) impide que un mensaje
-- quede colgando de un ticket de OTRA tienda, aunque el código se equivoque.
-- ============================================================================

create type support_category as enum (
	'CONFIGURATION',
	'DOMAIN',
	'PAYMENTS',
	'PLAN',
	'PRODUCTS_ORDERS',
	'ERROR',
	'OTHER'
);

create type support_ticket_status as enum ('OPEN', 'ANSWERED', 'CLOSED');

create type support_author as enum ('OWNER', 'TEAM');

create table support_tickets (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	opened_by_id uuid references users (id) on delete set null,
	subject text not null check (char_length(btrim(subject)) between 1 and 160),
	category support_category not null,
	status support_ticket_status not null default 'OPEN',
	owner_last_read_at timestamptz,
	team_last_read_at timestamptz,
	last_message_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	-- Destino de la FK compuesta de support_messages.
	unique (id, store_id)
);

create index support_tickets_store_last_message_idx on support_tickets (store_id, last_message_at desc);
create index support_tickets_status_last_message_idx on support_tickets (status, last_message_at);

create table support_messages (
	id uuid primary key default gen_random_uuid(),
	ticket_id uuid not null,
	store_id uuid not null references stores (id) on delete cascade,
	author support_author not null,
	author_user_id uuid references users (id) on delete set null,
	body text not null check (char_length(btrim(body)) between 1 and 5000),
	created_at timestamptz not null default now(),
	foreign key (ticket_id, store_id) references support_tickets (id, store_id) on delete cascade
);

create index support_messages_ticket_created_idx on support_messages (ticket_id, created_at);
create index support_messages_store_author_created_idx on support_messages (store_id, author, created_at);

-- Política igual a la de todo lo que cuelga de una tienda.
alter table support_tickets enable row level security;
alter table support_tickets force row level security;

create policy support_tickets_tenant_isolation on support_tickets for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

alter table support_messages enable row level security;
alter table support_messages force row level security;

create policy support_messages_tenant_isolation on support_messages for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

grant select, insert, update, delete on support_tickets to tienda_app;
grant select, insert, update, delete on support_messages to tienda_app;
