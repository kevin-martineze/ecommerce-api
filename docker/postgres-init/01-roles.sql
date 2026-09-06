-- ============================================================================
-- Rol de aplicación.
--
-- Corre UNA sola vez, cuando el contenedor de Postgres inicializa el volumen.
-- En producción esto se ejecuta a mano contra la base gestionada.
--
-- Por qué existe un rol aparte en vez de conectarse como `postgres`:
-- las políticas de RLS NO se aplican al dueño de la tabla. Si el API se
-- conectara con el rol dueño, `enable row level security` quedaría escrito en
-- las migraciones, se vería en el schema, y no protegería absolutamente nada.
-- El aislamiento entre tiendas depende de que esta conexión sea la restringida.
--
-- `nobypassrls` es explícito aunque sea el valor por defecto: es la propiedad
-- de la que cuelga toda la defensa en profundidad, y conviene que se lea.
-- ============================================================================

create role tienda_app with login password 'tienda_app' nobypassrls nocreatedb nocreaterole nosuperuser;

-- El esquema lo crean las migraciones con el rol dueño; los permisos de tabla
-- para `tienda_app` se otorgan desde una migración versionada, no desde aquí,
-- para que producción y local no se separen.
grant connect on database tienda to tienda_app;
