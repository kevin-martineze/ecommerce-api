-- ============================================================================
-- Lo que consume el asistente de cada tienda.
--
-- Una fila por respuesta. Sirve para dos cosas: cobrar el tope del plan (no se
-- puede topear lo que no se cuenta) y saber cuánto cuesta de verdad una
-- conversación, con números propios y no con estimaciones.
--
-- NO se guarda la pregunta ni la respuesta. Son conversaciones de las clientas
-- de la tienda —datos personales de las que no tenemos nada que hacer con un
-- historial—, y para contar y medir bastan los tokens. Si algún día hace falta
-- revisar conversaciones, será con una decisión y un aviso, no por descuido.
--
-- Va bajo RLS como todo lo que cuelga de una tienda: la política y los
-- permisos son los mismos que aplica la migración de integridad.
-- ============================================================================

create table ai_replies (
	id uuid primary key default gen_random_uuid(),
	store_id uuid not null references stores (id) on delete cascade,
	input_tokens integer not null default 0,
	output_tokens integer not null default 0,
	created_at timestamptz not null default now()
);

-- El tope es mensual y siempre se pregunta por tienda y por mes.
create index ai_replies_store_created_idx on ai_replies (store_id, created_at desc);

alter table ai_replies enable row level security;
alter table ai_replies force row level security;

create policy ai_replies_tenant_isolation on ai_replies for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

grant select, insert, update, delete on ai_replies to tienda_app;
