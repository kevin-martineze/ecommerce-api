#!/bin/sh
# ============================================================================
# Rol de aplicación.
#
# Corre UNA sola vez, cuando el contenedor de Postgres inicializa el volumen.
# En producción esto se ejecuta con la clave que traiga el entorno; en local,
# con una de ejemplo.
#
# Por qué existe un rol aparte en vez de conectarse como `postgres`:
# las políticas de RLS NO se aplican al dueño de la tabla. Si el API se
# conectara con el rol dueño, `enable row level security` quedaría escrito en
# las migraciones, se vería en el schema, y no protegería absolutamente nada.
# El aislamiento entre tiendas depende de que esta conexión sea la restringida.
#
# `nobypassrls` es explícito aunque sea el valor por defecto: es la propiedad
# de la que cuelga toda la defensa en profundidad, y conviene que se lea.
#
# Es un script y no un `.sql` porque la clave llega por variable de entorno:
# un `.sql` no puede interpolarla, y dejarla escrita en el repositorio
# significaría que la de producción es pública.
# ============================================================================
set -e

CLAVE="${APP_DB_PASSWORD:-tienda_app}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v clave="$CLAVE" <<'SQL'
create role tienda_app with login password :'clave' nobypassrls nocreatedb nocreaterole nosuperuser;

-- El esquema lo crean las migraciones con el rol dueño; los permisos de tabla
-- para `tienda_app` se otorgan desde una migración versionada, no desde aquí,
-- para que producción y local no se separen.
grant connect on database :"POSTGRES_DB" to tienda_app;
SQL
