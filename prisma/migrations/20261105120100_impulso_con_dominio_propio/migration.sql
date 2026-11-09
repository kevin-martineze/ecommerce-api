-- ============================================================================
-- El plan Impulso incluye dominio propio. Pro ya lo incluía desde su creación.
-- ============================================================================

update plans set custom_domain = true where code = 'impulso';
