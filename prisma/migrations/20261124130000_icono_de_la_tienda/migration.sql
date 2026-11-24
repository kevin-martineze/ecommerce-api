-- ============================================================================
-- Ícono de la tienda: el favicon, el ícono del celular y la imagen al compartir.
--
-- Va aparte del logo porque el logo es ancho (el nombre escrito) y un ícono
-- tiene que leerse en 16 px: casi siempre es solo la inicial o el símbolo.
-- Null = la tienda sigue usando su logo, como hasta ahora.
-- ============================================================================

alter table store_settings
	add column icon_url text,
	add column icon_storage_path text;
