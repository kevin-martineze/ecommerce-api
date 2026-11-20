-- ============================================================================
-- Avisos push: los navegadores que pidieron avisos con el panel cerrado.
--
-- Una fila por navegador y por bandeja. La bandeja es la de una tienda o, con
-- store_id nulo, la de la consola; el mismo navegador puede pedir las dos.
--
-- Sin RLS, como refresh_tokens: la suscripción es de la cuenta y se busca por
-- endpoint. Lo que se manda por push es el mismo aviso de la bandeja (ids,
-- números y nombres de la tienda), nunca datos de una clienta.
-- ============================================================================

create table push_subscriptions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users (id) on delete cascade,
	store_id uuid references stores (id) on delete cascade,
	endpoint text not null check (endpoint like 'https://%'),
	p256dh text not null,
	auth text not null,
	created_at timestamptz not null default now()
);

-- Un navegador se suscribe una vez por bandeja. `nulls not distinct`: dos
-- filas de consola (store_id nulo) para el mismo endpoint también chocan.
create unique index push_subscriptions_endpoint_inbox_key on push_subscriptions (endpoint, store_id) nulls not distinct;

-- A quién mandarle un aviso: las suscripciones de una bandeja y sus personas.
create index push_subscriptions_inbox_idx on push_subscriptions (store_id, user_id);

grant select, insert, delete on push_subscriptions to tienda_app;
