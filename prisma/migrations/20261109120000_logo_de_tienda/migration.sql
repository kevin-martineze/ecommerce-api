-- ============================================================================
-- Logo de la tienda. Null = sin logo: la tienda muestra el nombre.
-- ============================================================================

alter table store_settings
  add column logo_url text,
  add column logo_storage_path text;
