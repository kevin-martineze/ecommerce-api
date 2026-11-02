#!/usr/bin/env bash
# Despliega en el servidor lo que hay en `main`.
#
# Se corre EN el servidor, dentro del clon del repositorio (/opt/globerce):
#
#   cd /opt/globerce
#   git pull origin main
#   ./deploy.sh
#
# Construye la imagen allá mismo (la instancia es ARM y `argon2` y `sharp`
# traen binarios nativos) y recrea solo los contenedores que cambiaron: la base
# no se reinicia. Las migraciones las aplica la propia API al arrancar
# (docker/entrypoint.sh); si fallan, el contenedor no queda sirviendo.
#
# Las variables viven en `.env.production`, junto a este archivo y fuera de git.
#
# Opcional, en el entorno o en `.deploy.env` del servidor:
#   DEPLOY_COMPOSE="-f docker-compose.prod.yml -f docker-compose.sin-dominio.yml"
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .deploy.env ]; then
  # shellcheck disable=SC1091
  . ./.deploy.env
fi

COMPOSE_FILES="${DEPLOY_COMPOSE:--f docker-compose.prod.yml -f docker-compose.caddy.yml}"
IMAGE=globerce-api
# Cuánto esperar a que la API responda después de arrancar. Incluye las
# migraciones, que corren antes de que el proceso escuche.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }
compose() {
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES "$@"
}

step "1/5 Revisando el repositorio"
[ -f .env.production ] || fail "Falta .env.production en $(pwd)."

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "Estás en la rama «$branch». Solo se despliega main: git checkout main && git pull origin main"

# Un cambio hecho a mano en el servidor se perdería en el próximo pull, o lo
# bloquearía. Mejor detenerse y que se suba por git.
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "Hay cambios sin commit en el servidor. Descártalos (git checkout -- .) o súbelos desde tu máquina."
fi

git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  printf 'Aviso: este clon no está al día con origin/main. ¿Olvidaste el git pull?\n'
  git log --oneline -1 origin/main
fi

commit="$(git rev-parse --short HEAD)"
printf 'Desplegando %s\n' "$(git log --oneline -1)"

step "2/5 Construyendo la imagen"
# La imagen que está corriendo queda como `previous`, por si hay que volver.
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:previous"
fi
docker build -t "$IMAGE:latest" .

step "3/5 Levantando los contenedores"
compose up -d --remove-orphans

step "4/5 Esperando a que la API responda"
# Se consulta desde dentro del contenedor: la API no publica su puerto, solo
# Caddy lo alcanza. `/ready` además confirma que hay conexión con la base.
prefix="$(grep -E '^API_PREFIX=' .env.production | cut -d= -f2- || true)"
prefix="${prefix:-v1}"
url="http://localhost:3000/$prefix/health/ready"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))

until compose exec -T api node -e "fetch('$url').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    compose logs --tail 60 api
    fail "La API no respondió en ${HEALTH_TIMEOUT}s. Revisa los registros de arriba.
Para volver a la versión anterior:
  docker tag $IMAGE:previous $IMAGE:latest && docker compose $COMPOSE_FILES up -d api
Ojo: si alguna migración ya se aplicó, la versión anterior corre contra el esquema nuevo."
  fi
  sleep 3
done

step "5/5 Limpiando"
compose ps
# Borra solo las capas sin nombre: `latest` y `previous` quedan, así el disco
# no crece con cada despliegue.
docker image prune -f >/dev/null

printf '\n\033[32mListo: %s en producción.\033[0m\n' "$commit"
