#!/usr/bin/env bash
# Despliega la API en la instancia EC2.
#
#   ./scripts/deploy-ec2.sh
#
# Copia el código, construye la imagen EN el servidor y reinicia los
# contenedores. Construir allá y no acá es deliberado: la instancia es ARM y
# `argon2` y `sharp` traen binarios nativos; una imagen hecha en un portátil
# x86 no arranca. Además evita subir casi un giga por cada despliegue.
#
# Configuración, en `.deploy.env` (no se versiona):
#
#   DEPLOY_HOST=ubuntu@1.2.3.4
#   DEPLOY_KEY=~/.ssh/globerce.pem      opcional
#   DEPLOY_COMPOSE="-f docker-compose.prod.yml -f docker-compose.caddy.yml"
#
# El archivo de variables del servidor (`.env.production`) vive SOLO allá, en
# /opt/globerce. Este script no lo sube ni lo lee.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .deploy.env ]; then
  # shellcheck disable=SC1091
  . ./.deploy.env
fi

: "${DEPLOY_HOST:?Falta DEPLOY_HOST (usuario@ip) en .deploy.env}"
COMPOSE_FILES="${DEPLOY_COMPOSE:--f docker-compose.prod.yml -f docker-compose.sin-dominio.yml}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/globerce}"
SSH_OPTS=()

if [ -n "${DEPLOY_KEY:-}" ]; then
  SSH_OPTS=(-i "${DEPLOY_KEY/#\~/$HOME}")
fi

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "1/4 Copiando el código a $DEPLOY_HOST:$REMOTE_DIR"
# `--delete` deja el servidor igual al repositorio: un archivo borrado acá se
# borra allá. Lo que NO se toca está en `--exclude`: las variables y los datos.
#
# Las exclusiones van ancladas con `/`: sin la barra, rsync las aplica a
# CUALQUIER nivel, y `media` se llevaba también `src/shared/media` — la imagen
# construía bien y el contenedor moría al arrancar.
rsync -az --delete \
  --exclude /node_modules --exclude /dist --exclude /.git --exclude /media \
  --exclude '/.env*' --exclude /coverage --exclude /.deploy.env \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "$DEPLOY_HOST:$REMOTE_DIR/"

step "2/4 Construyendo la imagen en el servidor"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "cd $REMOTE_DIR && docker build -t globerce-api:latest ."

step "3/4 Levantando los contenedores"
# `up -d` recrea solo lo que cambió. Las migraciones las corre el propio
# contenedor al arrancar (docker/entrypoint.sh).
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "cd $REMOTE_DIR && docker compose $COMPOSE_FILES up -d --remove-orphans"

step "4/4 Comprobando"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "cd $REMOTE_DIR && docker compose $COMPOSE_FILES ps && docker image prune -f >/dev/null"

printf '\nListo. Si algo falla: ssh %s \"cd %s && docker compose logs -f api\"\n' "$DEPLOY_HOST" "$REMOTE_DIR"
