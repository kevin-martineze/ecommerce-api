# Despliegue

Qué hay que crear y configurar para poner la plataforma en producción. El
porqué de cada pieza está en `ARCHITECTURE.md`; esto es la lista de pasos.

Piezas:

| Pieza          | Servicio elegido        | Variables                                      |
| -------------- | ----------------------- | ---------------------------------------------- |
| Base de datos  | Postgres gestionado     | `DATABASE_URL`, `DIRECT_URL`                   |
| Fotos          | Cloudflare R2           | `STORAGE_DRIVER=s3`, `S3_*`                    |
| Correo         | cualquier SMTP          | `MAIL_DRIVER=smtp`, `SMTP_URL`, `MAIL_FROM`    |
| Cobro          | por ahora, a mano       | `BILLING_DRIVER=manual` (ver ARCHITECTURE)     |
| API            | un servidor Node 22     | todo lo de `.env.example`                      |
| Tienda y panel | Vercel (`shopping-sas`) | ver su `.env.example`                          |
| Vencimientos   | cron del servidor       | `pnpm platform:reconcile` una vez al día       |
| Cobro del plan | cron del servidor       | `pnpm platform:charge-due`, antes del anterior |

---

## 1. Fotos en Cloudflare R2

La API sube las fotos por el protocolo de S3, y R2 lo habla. Se eligió R2
porque no cobra por descarga: en una tienda, casi todo el tráfico son fotos
que se descargan.

### 1.1 Bucket

1. Panel de Cloudflare → **R2 Object Storage** → **Create bucket**.
2. Nombre: `tienda-media` (o el que se prefiera; va en `S3_BUCKET`).
   Ubicación automática.

### 1.2 Acceso público por un dominio propio

Las fotos las pide el navegador directamente al bucket; la API nunca las
sirve en producción.

1. Bucket → **Settings** → **Public access** → **Custom Domains** →
   **Connect Domain**.
2. Un subdominio del dominio de la plataforma, por ejemplo
   `media.globerce.com`. El dominio tiene que estar en Cloudflare (sus
   nameservers).
3. Ese valor, con `https://` y sin barra final, va en `S3_PUBLIC_URL`.

La URL `r2.dev` que ofrece Cloudflare sirve para probar, pero tiene límite
de peticiones y Cloudflare no la recomienda para producción.

No hace falta configurar CORS en el bucket: las fotos se muestran con
`<img>`, y las sube la API desde el servidor, no el navegador.

Cada objeto se guarda con `Cache-Control: public, max-age=31536000,
immutable`. Las claves llevan una marca de tiempo y nunca se reutilizan, así
que el caché de Cloudflare puede guardarlas para siempre.

### 1.3 Credenciales

1. R2 → **Manage R2 API Tokens** → **Create API Token**.
2. Permiso **Object Read & Write**, limitado al bucket `tienda-media`.
3. Copiar el **Access Key ID** y el **Secret Access Key** (el secreto se
   muestra una sola vez) y el endpoint S3 de la cuenta:
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

### 1.4 Variables de la API

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=tienda-media
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_PUBLIC_URL=https://media.globerce.com
S3_FORCE_PATH_STYLE=false
```

### 1.5 Comprobar

```bash
pnpm storage:check
```

Sube un archivo pequeño, lo pide por `S3_PUBLIC_URL` como lo haría un
navegador y lo borra. Si falla al leer, el problema es el dominio público o
el acceso público del bucket, no las credenciales.

### 1.6 Llevar las fotos existentes

- **Desde Supabase** (la tienda original): después de
  `pnpm db:import-supabase`, correr
  `pnpm db:import-supabase-media --slug <tienda>` con las variables de R2
  puestas. Descarga cada foto de Supabase y la sube directo al bucket.
- **Desde el disco local** (una tienda que ya usaba `STORAGE_DRIVER=local`):
  `pnpm storage:push-local --slug <tienda>` con las variables de R2 puestas y
  `MEDIA_DIR` apuntando a la carpeta de fotos. Las claves no cambian, solo la
  URL pública.

Los dos scripts se pueden relanzar: lo que ya está en el bucket se salta.
Primero con `--dry-run`.

### 1.7 En local, sin Cloudflare

MinIO habla el mismo protocolo y sirve para probar el driver `s3`:

```bash
podman run -d --name tienda-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 \
  quay.io/minio/minio server /data --console-address :9001
```

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=tienda-media
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio12345
S3_PUBLIC_URL=http://127.0.0.1:9000/tienda-media
S3_FORCE_PATH_STYLE=true
```

El bucket necesita lectura pública (el e2e `storage-s3` la configura). Ojo:
podman también lee `STORAGE_DRIVER` del entorno y se queja si ve `s3`; en esa
terminal, correr podman con `STORAGE_DRIVER=` vacío.

---

## 2. Dominios

Cada tienda es un subdominio (`boutique.globerce.com`), así que hace falta
un registro DNS comodín `*.globerce.com` apuntando al frontend, y un
certificado comodín.

**Decisión pendiente:** si el frontend va en Vercel, Vercel pide manejar los
nameservers del dominio para emitir el certificado comodín (confirmarlo en
su documentación al configurar). Eso choca con tener el mismo dominio en
Cloudflare para `media.globerce.com`. Opciones:

- Dominio de la plataforma en Vercel, y las fotos en un dominio aparte que sí
  esté en Cloudflare (`globerce-media.com`).
- Dominio en Cloudflare y el frontend también en Cloudflare (Workers con
  `@sveltejs/adapter-cloudflare`).
- Dominio en Cloudflare con el comodín en modo proxy hacia Vercel (Cloudflare
  emite el certificado de cara al público).

---

## 3. Base de datos

1. Crear la base en el proveedor.
2. `DIRECT_URL`: usuario dueño, conexión directa sin pooler. Con ella:
   `pnpm db:deploy`.
3. Crear el usuario de la aplicación **sin** `BYPASSRLS` y sin ser dueño de
   las tablas (ver `docker/postgres-init/01-roles.sql`). `DATABASE_URL` usa
   ese usuario. Si se usa el dueño, el aislamiento entre tiendas deja de
   aplicarse sin ningún error visible.
4. `pnpm platform:grant-admin --email <correo>` para la primera cuenta de la
   plataforma (la cuenta tiene que existir).

---

## 4. Lo demás

- **API no expuesta a internet.** El límite por IP confía en el
  `X-Forwarded-For` que manda el frontend: la API tiene que quedar detrás de
  una red privada o de un secreto compartido (ARCHITECTURE § 3).
- **`FRONTEND_URL`** con el dominio real: es la base de los enlaces de los
  correos.
- **Cron diario:** `pnpm platform:charge-due` y después `pnpm platform:reconcile`.
- **Frontend en Vercel:** `API_URL`, `SESSION_SECRET`, `PUBLIC_SITE_URL`,
  `STORE_ROOT_DOMAIN` y, si el dominio raíz muestra una tienda, `STORE_SLUG`.
