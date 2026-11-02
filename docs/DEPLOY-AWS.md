# Despliegue en AWS: la API en una instancia EC2

La API y su Postgres corren en una sola instancia, en contenedores. Es la
opción más barata y la más fácil de entender; a cambio, los respaldos, las
actualizaciones del sistema y el certificado son responsabilidad nuestra.
Cuando haya suficientes tiendas, la base se mueve a RDS sin tocar el código:
es cambiar `DATABASE_URL` y `DIRECT_URL`.

Lo que NO vive aquí: las fotos (Cloudflare R2, ver `DEPLOY.md` § 1) y el
frontend (Vercel).

```
            Vercel (tienda, panel y consola)
                        │  HTTPS + x-globerce-key
                        ▼
                EC2 t4g.small (Ubuntu ARM)
                 ├── Caddy      certificado y proxy
                 ├── API        contenedor Node 22
                 └── Postgres   contenedor + respaldo diario a S3
                        │
                        ▼
              Cloudflare R2 (fotos de las tiendas)
```

---

## 1. Por qué la API puede tener IP pública

La API no debería ser alcanzable desde internet (ARCHITECTURE § 3): sus rutas
públicas no llevan límite por IP y le cree al `X-Forwarded-For` que manda el
frontend. En una instancia suelta no hay red privada donde esconderla, así que
la puerta es un secreto compartido: `API_SHARED_SECRET`. Sin esa cabecera, la
API responde 403 a todo, salvo las sondas de salud.

No reemplaza a una red privada, pero convierte "cualquiera puede llamar" en
"hay que conocer un secreto de 48 caracteres que solo tiene Vercel".

---

## 2. Crear la instancia

Región **us-east-2** (Ohio): mismo precio que Virginia y latencia
equivalente desde Colombia. La cuenta ya está ahí.

| Qué    | Valor                                                |
| ------ | ---------------------------------------------------- |
| Tipo   | `t4g.small` (ARM, 2 vCPU, 2 GB) — unos USD 12/mes    |
| Imagen | Ubuntu Server 24.04 LTS **arm64**                    |
| Disco  | 30 GB gp3 (el máximo de la capa gratis)              |
| Llave  | una nueva, `globerce.pem`, guardada con permisos 400 |
| IP     | una IP elástica, para que no cambie al reiniciar     |

Grupo de seguridad `globerce-api`:

| Puerto | Desde      | Para qué                   |
| ------ | ---------- | -------------------------- |
| 22     | solo tu IP | entrar por SSH             |
| 80     | 0.0.0.0/0  | el desafío del certificado |
| 443    | 0.0.0.0/0  | la API                     |

Postgres (5432) **no se abre**: solo lo alcanza la API por la red interna de
los contenedores. Para consultarlo desde tu máquina se usa un túnel SSH (§ 7).

---

## 3. Preparar el servidor

Lo hace el `user-data` al primer arranque, así que no hay nada que escribir a
mano: instala `docker.io`, `docker-compose-v2`, `postgresql-client` y
`unattended-upgrades` (parches de seguridad automáticos), y crea
`/opt/globerce`. Termina cuando existe `/opt/globerce/.listo`, unos dos
minutos después de lanzar la instancia.

```bash
ssh -i ~/.ssh/globerce.pem ubuntu@<IP> "test -f /opt/globerce/.listo && echo listo"
```

---

## 4. Variables del servidor

`/opt/globerce/.env.production`, creado **en la instancia** y nunca en el
repositorio. Los secretos se generan con `openssl rand -base64 48`.

```env
NODE_ENV=production
PORT=3000

# Postgres corre en el mismo compose: el host es el nombre del servicio.
DATABASE_URL=postgresql://tienda_app:<clave del rol>@postgres:5432/globerce
DIRECT_URL=postgresql://postgres:<clave de postgres>@postgres:5432/globerce
POSTGRES_PASSWORD=<clave de postgres>

JWT_SECRET=<48 caracteres>
COOKIE_SECRET=<48 caracteres>
API_SHARED_SECRET=<48 caracteres, el mismo que va en Vercel>

CORS_ORIGINS=https://globerce.com
FRONTEND_URL=https://globerce.com
API_DOMAIN=api.globerce.com

# Fotos en R2 (ver DEPLOY.md § 1)
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=ecommerce
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://media.globerce.com
S3_FORCE_PATH_STYLE=false

# Cobro. `manual`: los pagos los registra la plataforma desde su consola.
# `simulated` deja que cada tienda active su plan sola con un pago de mentira:
# sirve para probar el flujo, nunca para cobrar de verdad.
BILLING_DRIVER=manual

# Correo
MAIL_DRIVER=smtp
SMTP_URL=smtp://usuario:clave@smtp.proveedor.com:587
MAIL_FROM="Globerce <no-responder@globerce.com>"
```

La clave del rol `tienda_app` la fija `docker/postgres-init/01-roles.sql` la
primera vez que se crea el volumen. **Cámbiala antes del primer arranque**, o
después con `alter role tienda_app with password '…'`.

---

## 5. Desplegar

Se despliega lo que está en `main` de GitHub, desde el servidor. Los cambios
se suben desde tu máquina como siempre (PR y merge a `main`); para ponerlos en
producción:

```bash
ssh -i ~/.ssh/globerce.pem ubuntu@<IP>
cd /opt/globerce
git pull origin main
./deploy.sh
```

`deploy.sh`:

1. Revisa que estés en `main`, sin cambios hechos a mano en el servidor, y que
   exista `.env.production`.
2. Construye la imagen **en el servidor** (la instancia es ARM y `argon2` y
   `sharp` traen binarios nativos). La que estaba corriendo queda como
   `globerce-api:previous`.
3. Recrea solo los contenedores que cambiaron: Postgres no se reinicia.
4. Espera a que `/v1/health/ready` responda. Las migraciones las aplica la
   propia API al arrancar (`docker/entrypoint.sh`); si fallan, el contenedor
   no queda sirviendo y el script muestra los registros.

Por defecto usa `-f docker-compose.prod.yml -f docker-compose.caddy.yml`. Para
otro overlay, `DEPLOY_COMPOSE="…"` en `/opt/globerce/.deploy.env`.

Volver a la versión anterior:

```bash
docker tag globerce-api:previous globerce-api:latest
docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml up -d api
```

Ojo: una migración ya aplicada no se deshace sola; la versión anterior corre
contra el esquema nuevo.

### Pasar el servidor a git (una sola vez)

Antes, `/opt/globerce` se llenaba con `rsync` desde el portátil y no era un
repositorio. Para convertirlo sin tocar `.env.production`, `backups/` ni la
base:

```bash
cd /opt/globerce
which git || sudo apt install -y git
git init -b main
git remote add origin https://github.com/kevin-martineze/ecommerce-api.git
git fetch origin main
git reset --hard origin/main      # deja el código igual a main; lo ignorado no se toca
git branch --set-upstream-to=origin/main
git status                        # debe decir «nothing to commit»
./deploy.sh
```

Si `git status` muestra archivos sueltos, son restos de las copias con
`rsync`: revísalos y bórralos (`git clean -n` para ver, `git clean -f` para
borrar). `git clean` no toca lo que está en `.gitignore`.

### HTTPS sin dominio propio

Un certificado se emite para un NOMBRE, no para una IP, así que sin dominio
no habría HTTPS. `sslip.io` resuelve cualquier nombre con forma de IP a esa
IP: `18-227-142-167.sslip.io` apunta a la instancia sin registrar nada. Con
eso, Let's Encrypt emite un certificado de verdad y Caddy lo renueva solo.

Es el puente hasta comprar el dominio: cuando exista, se cambia `API_DOMAIN`
a `api.<dominio>`, se apunta el DNS a la IP y Caddy pide el certificado
nuevo. Nada más cambia.

`-f docker-compose.sin-dominio.yml` queda para depurar sin certificado: la API
sale por el puerto 80 en claro. No se atiende a nadie así.

### Primera vez

Registrarse desde el frontend y, ya con la cuenta creada, darle acceso a la
consola de la plataforma desde el servidor:

```bash
docker compose exec postgres psql -U postgres -d globerce \
  -c "insert into platform_admins (user_id) select id from users where email='<correo>'"
```

---

## 6. DNS y certificado

`api.globerce.com` → A → la IP elástica. Si el dominio está en Cloudflare, ese
registro va **sin proxy** (nube gris): Caddy necesita hablar directo con Let's
Encrypt para emitir el certificado.

La primera vez que arranca con `API_DOMAIN` puesto, Caddy pide el certificado
solo y lo renueva desde entonces.

---

## 7. Operación

```bash
# Ver la API
ssh ubuntu@<IP> "cd /opt/globerce && docker compose logs -f api"

# Entrar a la base desde tu máquina (sin abrir el puerto en el grupo de seguridad)
ssh -i ~/.ssh/globerce.pem -L 5433:localhost:5432 ubuntu@<IP>
# y en otra terminal: psql postgresql://postgres:<clave>@localhost:5433/globerce
```

### Las tareas diarias

Están instaladas en `/etc/cron.d/globerce` y corren de madrugada, hora de
Colombia:

| Hora (UTC) | Qué hace                                                  | Log                               |
| ---------- | --------------------------------------------------------- | --------------------------------- |
| 08:10      | `scripts/backup-db.sh`: copia de la base                  | `/var/log/globerce-backup.log`    |
| 08:30      | `dist/tasks/charge-due`: cobra los planes que vencen hoy  | `/var/log/globerce-charge.log`    |
| 08:40      | `dist/tasks/reconcile`: marca vencidas pruebas y períodos | `/var/log/globerce-reconcile.log` |

Sin la última, una tienda que dejó de pagar se ve al día para siempre: en la
API no hay reloj, el vencimiento lo marca esa tarea (ver ARCHITECTURE § 13).

El orden entre las dos últimas no es casual: el cobro va ANTES. Si cobra bien,
la tienda no llega a marcarse como vencida ese mismo día; al revés, la dueña
vería un aviso de pago vencido por una tarjeta que sí funcionó.

Ninguna usa `ts-node` ni `dotenv`: la imagen de producción no los trae. Las
variables llegan del `env_file` de compose.

### Respaldos

`scripts/backup-db.sh` hace el volcado con el `pg_dump` del propio contenedor
de Postgres, lo comprime en `backups/` y comprueba que termine con la línea
que `pg_dump` escribe al cerrar: es lo que distingue una copia entera de una
cortada, y el día que haya que restaurar ya no hay forma de saberlo. Conserva
las últimas 7 locales.

Después intenta subirla con `dist/tasks/upload-backup`, que usa el SDK de S3
que ya está en la imagen —una copia que depende de instalar algo en el
servidor es una copia que alguien, algún día, no va a poder restaurar—. El
destino es un bucket **distinto del de las fotos y privado**: el de las fotos
se sirve público, y ahí un volcado de la base sería un volcado público.

```bash
# En .env.production del servidor
BACKUP_S3_BUCKET=globerce-backups   # privado, distinto al de las fotos
BACKUP_KEEP=30                      # copias que se conservan afuera
```

El token de R2 de las fotos **no** sirve: está limitado a su bucket y responde
`Access Denied` al crear otro. Hace falta un token con permiso sobre el bucket
de respaldos. Mientras no lo haya, el script deja la copia local y lo dice.

Restaurar:

```bash
gunzip -c backups/globerce-FECHA.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d globerce
```

**Un respaldo que nadie ha restaurado no es un respaldo**: conviene probar la
restauración una vez, contra una base de prueba.

---

## 8. Lo que ya está creado

| Recurso            | Valor                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Instancia          | `i-0827bfb44da35c4f4`, t4g.small, Ubuntu 24.04 ARM                   |
| IP fija            | `18.227.142.167`                                                     |
| Grupo de seguridad | `globerce-api`: 22 desde una IP, 80 y 443 abiertos                   |
| Llave SSH          | `~/.ssh/globerce.pem` (solo en el portátil; AWS no la guarda)        |
| Presupuesto        | `globerce-mensual`, avisa al 50 % de USD 25 y si se proyecta pasarlo |

La IP de SSH es la del portátil el día que se creó. Si cambia (otra red), hay
que actualizar la regla:

```bash
aws ec2 authorize-security-group-ingress --group-name globerce-api \
  --protocol tcp --port 22 --cidr $(curl -s https://checkip.amazonaws.com)/32
```

---

## 9. Lo que falta cuando crezca

- **La base a RDS**, con respaldos automáticos y restauración a un punto en el
  tiempo. Solo cambian dos variables.
- **Dos instancias detrás de un balanceador**, cuando una no alcance. El
  código ya está listo: las fotos están en R2 y no en disco, y no hay estado
  en memoria salvo el límite de tráfico.
- **Red privada** entre Vercel y la API, para no depender del secreto
  compartido.
