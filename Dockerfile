# Imagen de la API de Globerce.
#
# Tres etapas para que la imagen final no cargue con el compilador ni con las
# dependencias de desarrollo. Se construye en la misma arquitectura en la que
# corre (la instancia es ARM): `argon2` y `sharp` traen binarios nativos, así
# que una imagen construida en x86 no arranca en ARM.
#
# Debian slim y no Alpine: los binarios nativos que descargan esos dos paquetes
# son para glibc, y en musl hay que recompilarlos.

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencias: todas, para poder compilar.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate

# ---------------------------------------------------------------------------
# Compilación: TypeScript a JavaScript.
# ---------------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN pnpm run build

# ---------------------------------------------------------------------------
# Producción: solo lo que hace falta para correr.
#
# La CLI de `prisma` es dependencia de producción a propósito: el arranque
# aplica las migraciones con ella (ver docker/entrypoint.sh).
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# Prisma busca la versión de OpenSSL del sistema para elegir su motor nativo;
# sin ella advierte en cada arranque y adivina. `ca-certificates` lo necesitan
# las llamadas HTTPS salientes (R2, SMTP).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# `prisma generate` no toca la base, pero `prisma.config.ts` exige `DIRECT_URL`
# —y hace bien: es la conexión con la que se migra—. En el build no existe, así
# que va un valor de relleno que nadie usa. La de verdad llega al arrancar.
RUN DIRECT_URL=postgresql://relleno:relleno@localhost:5432/relleno \
  pnpm install --frozen-lockfile --prod \
  && DIRECT_URL=postgresql://relleno:relleno@localhost:5432/relleno \
  pnpm exec prisma generate \
  # El almacén de pnpm queda enlazado a `node_modules`, así que borrarlo no
  # quita nada de lo instalado y saca cientos de megas de la imagen.
  && rm -rf /pnpm

COPY --from=build /app/dist ./dist
COPY --chmod=755 docker/entrypoint.sh ./docker/entrypoint.sh

# Solo `media` necesita escritura, y solo con el driver local. Un `chown -R`
# sobre /app copiaría `node_modules` entero a una capa nueva: media imagen más.
#
# Node ya trae el usuario `node`. Correr como root dentro del contenedor no
# aporta nada y convierte cualquier ejecución remota en root de la imagen.
RUN install -d -o node -g node /app/media

USER node

EXPOSE 3000

# El supervisor reinicia el contenedor si esto falla; no toca la base, así que
# una caída momentánea de Postgres no dispara reinicios en cadena.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'+(process.env.API_PREFIX||'v1')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
