-- ============================================================================
-- Plantilla de la vitrina.
--
-- Guarda cuál de los diseños del frontend usa cada tienda. Es texto y no un
-- enum: estrenar una plantilla es desplegar el frontend, no migrar la base. Un
-- código que ya no exista no rompe la tienda —el frontend cae en el de por
-- defecto—, y por eso tampoco lleva CHECK: el que valida es el DTO, que es
-- quien sabe qué plantillas existen hoy.
--
-- Las tiendas que ya existen se quedan con el diseño que tenían, que es el que
-- ahora se llama `editorial`.
-- ============================================================================

alter table store_settings
	add column template text not null default 'editorial';
