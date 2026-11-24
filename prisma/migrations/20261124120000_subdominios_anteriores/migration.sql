-- ============================================================================
-- Subdominios anteriores: lo que deja una tienda al cambiar de dirección.
--
-- Una fila por subdominio que la tienda dejó. La tienda pública lo redirige al
-- actual con un 308, así que un enlace compartido nunca se rompe. Sigue siendo
-- de la tienda: nadie más lo puede registrar, para que ese enlace viejo no
-- termine en la tienda de otra persona.
--
-- Sin RLS, como `stores`: es parte del paso que decide de qué tienda se habla.
-- ============================================================================

create table store_slug_aliases (
	slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
	store_id uuid not null references stores (id) on delete cascade,
	created_at timestamptz not null default now()
);

create index store_slug_aliases_store_id_idx on store_slug_aliases (store_id);

grant select, insert, delete on store_slug_aliases to tienda_app;

-- Un subdominio vive en una sola de las dos tablas. La API lo revisa antes de
-- escribir; esto cierra la carrera de dos peticiones al mismo tiempo.
create function store_slug_not_aliased() returns trigger
language plpgsql as $$
begin
	if exists (
		select 1 from store_slug_aliases a where a.slug = new.slug and a.store_id <> new.id
	) then
		raise exception 'el subdominio % es la dirección anterior de otra tienda', new.slug
			using errcode = 'unique_violation';
	end if;
	return new;
end;
$$;

create trigger stores_slug_not_aliased
	before insert or update of slug on stores
	for each row execute function store_slug_not_aliased();

create function store_slug_alias_not_in_use() returns trigger
language plpgsql as $$
begin
	if exists (select 1 from stores s where s.slug = new.slug) then
		raise exception 'el subdominio % lo usa una tienda', new.slug
			using errcode = 'unique_violation';
	end if;
	return new;
end;
$$;

create trigger store_slug_aliases_not_in_use
	before insert on store_slug_aliases
	for each row execute function store_slug_alias_not_in_use();
