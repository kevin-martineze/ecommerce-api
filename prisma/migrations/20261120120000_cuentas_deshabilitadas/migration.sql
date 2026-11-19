-- ============================================================================
-- Cuentas deshabilitadas por la plataforma.
--
-- Null = activa. Sin índice: la columna se lee junto con la fila del usuario
-- (por id o por correo), nunca se filtra sola salvo en el listado de la
-- consola, que tiene tope de 200.
-- ============================================================================

alter table users add column disabled_at timestamp(3);
