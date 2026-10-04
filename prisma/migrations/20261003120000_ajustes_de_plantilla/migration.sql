-- ============================================================================
-- Ajustes de la plantilla.
--
-- Lo que la dueña le cambia a su plantilla sin cambiar de plantilla: color de
-- marca, pareja de letras, esquinas y portada. Es `jsonb` y no cuatro columnas
-- porque son códigos que define el frontend y van a crecer (el logo, el pie);
-- quien los valida es el DTO, y la API los lee con `readTheme`, que descarta lo
-- que no reconozca.
--
-- Null —o un objeto sin ajustes— es la plantilla tal cual: así queda toda
-- tienda que ya existe.
-- ============================================================================

alter table store_settings
	add column theme jsonb;
