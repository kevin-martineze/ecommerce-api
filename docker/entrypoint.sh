#!/bin/sh
# Arranque de la API en producción.
#
# Las migraciones corren aquí y no en un paso aparte del despliegue porque son
# lo primero que tiene que pasar y, si fallan, el contenedor no debe quedar
# sirviendo contra un esquema viejo: `set -e` corta y el supervisor reintenta.
#
# `prisma migrate deploy` solo aplica migraciones ya escritas, nunca genera ni
# borra nada: es lo que se puede correr sin supervisión.
set -e

if [ -z "$DIRECT_URL" ]; then
  echo "Falta DIRECT_URL (rol dueño de la base): las migraciones no pueden correr." >&2
  exit 1
fi

echo "Aplicando migraciones…"
./node_modules/.bin/prisma migrate deploy

echo "Arrancando la API…"
exec node --enable-source-maps dist/main
