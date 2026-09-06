# tienda-api

API multi-inquilino de la plataforma de tiendas de ropa. Cada tienda es un
inquilino con su propio catálogo, sus pedidos y su equipo; el mismo despliegue
las atiende a todas.

Consume esta API el frontend SvelteKit (`Projects/personal/tienda-ropa`), y lo
hace **servidor contra servidor**: el navegador de la clienta nunca habla
directamente con esta API.

**Stack:** NestJS 11 sobre Fastify · Prisma 7 con `@prisma/adapter-pg` ·
PostgreSQL 17 · argon2id · Swagger.

Para el diseño y el porqué de cada decisión, ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Requisitos

- Node 22 o superior
- pnpm 11
- Docker (solo para el Postgres local)

---

## Puesta en marcha

### 1. Dependencias

```bash
pnpm install
```

### 2. Base de datos

```bash
docker compose up -d postgres
```

Levanta PostgreSQL 17 en el 5432 y, la primera vez, crea el rol `tienda_app`
con el script de `docker/postgres-init/`. Ese rol es el que usa la aplicación
en runtime, y **no** es el dueño de las tablas: es lo que hace que las
políticas de RLS se apliquen de verdad (ver ARCHITECTURE.md § Aislamiento).

### 3. Variables de entorno

```bash
cp .env.example .env
```

Los valores por defecto sirven para local. Los dos secretos (`JWT_SECRET`,
`COOKIE_SECRET`) no tienen default en el validador a propósito: un default es
la forma clásica de terminar firmando tokens de producción con `change-me`.

### 4. Migraciones

```bash
pnpm db:migrate
```

### 5. Desarrollo

```bash
pnpm start:dev
```

- API: <http://localhost:3000/v1>
- Documentación: <http://localhost:3000/v1/docs> (no se monta en producción)
- Liveness: <http://localhost:3000/v1/health>
- Readiness: <http://localhost:3000/v1/health/ready>

---

## Comandos

| Comando             | Qué hace                                   |
| ------------------- | ------------------------------------------ |
| `pnpm start:dev`    | Servidor con recarga                       |
| `pnpm build`        | Compila a `dist/`                          |
| `pnpm typecheck`    | TypeScript sin emitir                      |
| `pnpm lint`         | ESLint con `--fix`                         |
| `pnpm lint:check`   | ESLint sin escribir (el que corre en CI)   |
| `pnpm format:check` | Prettier en modo verificación              |
| `pnpm test`         | Tests unitarios                            |
| `pnpm test:e2e`     | Tests de extremo a extremo                 |
| `pnpm db:migrate`   | Crea y aplica una migración en desarrollo  |
| `pnpm db:deploy`    | Aplica migraciones pendientes (producción) |
| `pnpm db:studio`    | Explorador de datos de Prisma              |
| `pnpm db:reset`     | Borra y reconstruye la base local          |

---

## Dos conexiones a la base, y por qué

| Variable       | Rol          | Para qué                 |
| -------------- | ------------ | ------------------------ |
| `DATABASE_URL` | `tienda_app` | Runtime. Sin BYPASSRLS.  |
| `DIRECT_URL`   | dueño        | Migraciones. Sin pooler. |

Si la aplicación se conectara con el rol dueño, `enable row level security`
quedaría escrito en las migraciones, se vería en el schema y no protegería
nada: las políticas no se aplican al dueño de la tabla. Y si las migraciones
corrieran por un pooler en modo transacción, fallarían con errores sobre
sentencias preparadas que no señalan la causa.

---

## Tropiezos conocidos en esta máquina

Están documentados porque cuestan una tarde cada uno:

- **`pnpm install` responde 401.** El `~/.npmrc` del usuario apunta al
  CodeArtifact privado de Pangea. El `.npmrc` del proyecto vuelve a fijar el
  registro público; no lo borres.

- **Prisma no descarga sus motores (`ETIMEDOUT` contra una dirección IPv6).**
  La red de esta máquina no enruta IPv6 y el descargador de Prisma ignora
  `--dns-result-order=ipv4first`. Por eso la versión de Prisma está **fijada
  exactamente a 7.9.1**, la misma de `bookings-api`: pnpm reutiliza los motores
  ya descargados desde su caché de efectos secundarios y no vuelve a bajarlos.
  Si algún día hay que subir de versión, hacelo con IPv6 disponible.

- **Un script de pnpm muere con `ERR_PNPM_IGNORED_BUILDS`.** pnpm revalida el
  árbol antes de cada script; si algún paquete queda como "build ignorado", ese
  install implícito termina en código 1 y se lleva el script por delante. Por
  eso `pnpm-workspace.yaml` decide explícitamente sobre cada paquete con
  scripts, incluido negar `@scarf/scarf`.
