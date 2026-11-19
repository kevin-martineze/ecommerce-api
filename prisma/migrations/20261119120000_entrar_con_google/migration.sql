-- ============================================================================
-- Entrar y registrarse con Google (dueñas y equipo).
--
-- `user_identities` ata una cuenta a la de un proveedor por su `sub`, nunca por
-- el correo. Sin RLS, igual que `users`: se resuelve antes de saber de qué
-- tienda se habla. Los permisos de `tienda_app` llegan por el
-- `alter default privileges` de 20260906215000.
--
-- `users.email_verified_at` queda en null para las cuentas que ya existen: no
-- hay forma de saber cuáles probaron su correo. Ver la pregunta abierta en el
-- plan (docs/plan-google-login.md de shopping-sas, §7).
-- ============================================================================

alter table users add column email_verified_at timestamp(3);

create table user_identities (
  id uuid not null,
  user_id uuid not null,
  provider text not null,
  provider_subject text not null,
  email text not null,
  created_at timestamp(3) not null default current_timestamp,

  constraint user_identities_pkey primary key (id),
  constraint user_identities_user_id_fkey foreign key (user_id)
    references users (id) on delete cascade on update cascade
);

create unique index user_identities_provider_provider_subject_key
  on user_identities (provider, provider_subject);

create index user_identities_user_id_idx on user_identities (user_id);
