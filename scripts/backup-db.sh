#!/usr/bin/env bash
#
# Copia de seguridad de la base, en el servidor.
#
#   ./scripts/backup-db.sh            una copia ahora
#   (el cron diario la llama con el mismo comando)
#
# Hace el volcado con el `pg_dump` del propio contenedor de Postgres —así la
# versión del cliente y la del servidor no se pueden separar—, lo comprime en
# `backups/` y, si hay almacenamiento externo configurado, lo sube.
#
# La copia local sirve para el accidente de todos los días (una tabla borrada);
# la externa, para el que se lleva la instancia entera. Sin la segunda, el
# respaldo vive en el mismo disco que lo que respalda.
#
# Restaurar:
#   gunzip -c backups/globerce-FECHA.sql.gz \
#     | docker compose exec -T postgres psql -U postgres -d globerce

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILES="${DEPLOY_COMPOSE:--f docker-compose.prod.yml -f docker-compose.caddy.yml}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
# Copias locales que se conservan. Una diaria: una semana.
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-7}"

mkdir -p "$BACKUP_DIR"

STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/globerce-$STAMP.sql.gz"

echo "1/3 Volcando la base…"
# `-T`: sin TTY, que es lo que deja redirigir la salida a un archivo.
docker compose $COMPOSE_FILES exec -T postgres \
  pg_dump -U postgres -d globerce --clean --if-exists \
  | gzip > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)

# `pg_dump` cierra su salida con esta línea. Comprobarla —y no el tamaño— es lo
# que distingue una copia entera de una cortada a la mitad: el día que haga
# falta restaurar ya no hay forma de saberlo.
if ! gunzip -c "$FILE" | tail -5 | grep -q 'PostgreSQL database dump complete'; then
  echo "El volcado quedó incompleto. Se conserva en $FILE para mirarlo." >&2
  exit 1
fi

echo "    $FILE ($SIZE)"

echo "2/3 Subiendo la copia…"
if docker compose $COMPOSE_FILES exec -T api node dist/tasks/upload-backup "/$FILE"; then
  echo "    Subida."
else
  echo "    No se pudo subir: la copia local queda en $FILE." >&2
fi

echo "3/3 Limpiando copias locales viejas…"
ls -1t "$BACKUP_DIR"/globerce-*.sql.gz 2>/dev/null | tail -n "+$((KEEP_LOCAL + 1))" | while read -r old; do
  rm -f "$old"
  echo "    Borrada $old"
done

echo "Listo."
