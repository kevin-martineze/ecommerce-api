-- ============================================================================
-- Dominios propios: el estado de la conexión de cada tienda con su dominio.
--
-- custom_domain ya existía (único, sin estado). Acá se agrega todo lo que
-- hace falta para saber en qué punto está: el estado, el token que prueba la
-- propiedad, los registros que pidió el proveedor, cuándo se verificó y cuándo
-- se revisó por última vez, y el último error para decírselo a la dueña.
--
-- custom_domain y custom_domain_status van juntos: sin dominio no hay estado,
-- y un estado sin dominio no tiene sentido. El formato lo valida el CHECK igual
-- que el slug, para que nada que no sea un nombre de host llegue a la base.
-- ============================================================================

create type custom_domain_status as enum ('PENDING', 'ACTIVE', 'FAILED');

alter table stores
  add column custom_domain_status custom_domain_status,
  add column custom_domain_token text,
  add column custom_domain_records jsonb,
  add column custom_domain_verified_at timestamptz(6),
  add column custom_domain_checked_at timestamptz(6),
  add column custom_domain_error text,
  add column custom_domain_added_at timestamptz(6),
  add constraint stores_custom_domain_status_pair
    check ((custom_domain is null) = (custom_domain_status is null)),
  add constraint stores_custom_domain_format
    check (
      custom_domain is null
      or (
        length(custom_domain) <= 253
        and custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
      )
    );
