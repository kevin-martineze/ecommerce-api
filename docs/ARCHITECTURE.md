# Arquitectura

Este documento explica **por qué** la API está construida así. El README explica
cómo levantarla; acá está el razonamiento detrás de cada decisión, para que
dentro de seis meses se pueda distinguir lo deliberado de lo accidental.

---

## 1. Qué problema resuelve

La primera versión de la tienda era de un solo inquilino: una tienda, un panel,
un Supabase. El objetivo ahora es vender el software por mensualidad, así que un
mismo despliegue tiene que atender a muchas tiendas sin que ninguna vea los
datos de otra.

Eso cambia dos cosas de raíz:

1. **Todo dato de negocio pertenece a una tienda.** Incluidos los que antes eran
   compartidos: colores, tallas y categorías. Dos tiendas nombran y ordenan sus
   tallas distinto, y una lista común obligaría a una de las dos a ceder.

2. **La seguridad deja de ser "está autenticado o no".** Ahora es "está
   autenticado, Y pertenece a esta tienda, Y su rol le alcanza".

---

## 2. Por qué una API aparte y no seguir con Supabase

En la versión anterior el navegador hablaba con Postgres a través de PostgREST,
y por eso la seguridad tenía que vivir dentro de la base: RLS para las lecturas
y funciones `security definer` en plpgsql para los pedidos. Era la decisión
correcta para esa forma.

Con multi-inquilino esa forma se rompe en un punto concreto: **con la clave
anónima, PostgREST no sabe qué tienda está pidiendo**. Acotar las lecturas
públicas por inquilino exigía o un GUC que el cliente puede falsear, o un header
igualmente falsificable. Ninguna de las dos es una frontera de seguridad.

Con una API de por medio, la frontera se mueve a un lugar donde sí se puede
defender, y el filtro por tienda pasa a ser un argumento obligatorio que el
compilador exige.

---

## 3. Las tres superficies

| Prefijo                   | Quién entra       | Qué la protege                        |
| ------------------------- | ----------------- | ------------------------------------- |
| `/v1/public/:storeSlug/*` | visitante anónimo | sin auth, `@Throttle` propio por ruta |
| `/v1/stores/:storeId/*`   | dueña y personal  | `JwtAuthGuard` + `StoreRolesGuard`    |
| `/v1/platform/*`          | administración    | `JwtAuthGuard` + `PlatformAdminGuard` |

Separarlas por prefijo, y no por lógica dentro de un mismo controlador, es
deliberado: cuando la superficie pública y la privada comparten ruta, tarde o
temprano alguien agrega un campo al DTO de respuesta y termina sirviéndoselo al
visitante sin darse cuenta.

La superficie pública usa el **slug** y no el UUID, porque forma parte de una
URL que se comparte por WhatsApp y porque así el CDN puede cachear por URL.

### El límite por IP, detrás del frontend

El frontend llama a esta API desde su servidor, así que sin ayuda todas las
visitantes llegan con la IP del servidor de la tienda. Un límite por IP sobre
las lecturas públicas terminaría frenando a la tienda entera, por eso esas
rutas llevan `@SkipThrottle`. Las escrituras públicas (aviso de reposición,
pedidos) y el login sí conservan su límite, y para que cuente la IP de la
visitante el frontend la reenvía en `X-Forwarded-For` (el adaptador arranca con
`trustProxy`).

Ese header lo puede falsificar cualquiera que llegue a la API directo. La
defensa real es que la API no sea alcanzable desde internet más que por el
frontend: red privada o un secreto compartido entre los dos. Queda pendiente
para el despliegue.

---

## 4. Aislamiento entre inquilinos: cuatro capas

La pregunta que responde este apartado es: _¿qué pasa si me equivoco?_ Una sola
capa significa que un error es una fuga. Acá cada capa cubre un fallo distinto.

### Capa 1 — El identificador viaja en el path

`/v1/stores/:storeId/productos`. No es una medida de seguridad: el path es
entrada del cliente, tan falsificable como un header. Se elige el path por tres
razones prácticas:

- queda en logs, trazas y mensajes de error sin trabajo extra;
- el CDN cachea por URL, sin depender de un `Vary` sobre un header — que si se
  olvida, le sirve el catálogo de una tienda a otra;
- Swagger y `curl` se leen sin adivinar.

### Capa 2 — El token está atado a la tienda

El access token lleva el `storeId` dentro. Si el del token no coincide con el
del path, la petición se rechaza antes de tocar la base.

Esta capa sí corta un ataque real: un token válido de la tienda A no puede
siquiera _nombrar_ a la tienda B. Quien administra dos tiendas cambia de una a
otra con `switch-store`, que re-emite el token después de verificar la
membresía.

### Capa 3 — La membresía se consulta en cada petición

`StoreRolesGuard` va a `store_members` en cada request en lugar de creerle al
claim del token.

Sin esto, quitarle el acceso a alguien surtiría efecto recién la próxima vez que
volviera a loguearse — que con tokens de 30 días puede ser nunca. Con esto, la
siguiente petición ya rebota.

El guard corre **siempre** que se aplica, tenga o no `@Roles` la ruta. `@Roles`
agrega una restricción encima, nunca la reemplaza: una ruta de solo lectura sin
`@Roles` que no verificara membresía dejaría entrar a cualquier usuario
autenticado de cualquier tienda.

### Capa 4 — RLS en Postgres

Las tres capas anteriores dependen de que el código pida bien. Esta cubre el
caso en que el código se equivoca: **un `where` al que se le olvidó el
`storeId`**.

Funciona así:

- La aplicación se conecta con el rol `tienda_app`, que **no es dueño de las
  tablas y no tiene BYPASSRLS**. Esto es lo que hace que las políticas se
  apliquen: conectarse con el rol dueño las desactivaría en silencio y
  `enable row level security` quedaría como decoración en las migraciones.
- Cada acceso a datos de tienda pasa por `PrismaService.forStore(storeId, ...)`,
  que abre una transacción y ejecuta `set_config('app.store_id', ..., true)`.
- Las políticas comparan `store_id` contra ese valor.

Resultado: una consulta sin filtro devuelve **cero filas**, no las de otra
tienda.

Tres detalles sostienen la garantía, y los tres están comentados en
`src/prisma/prisma.service.ts`:

1. El tercer argumento de `set_config` en `true` lo hace local a la transacción.
   Con `false`, el valor sobreviviría en la conexión y, al volver esa conexión
   al pool, la siguiente petición heredaría el inquilino anterior — que es
   exactamente el fallo que esta capa existe para impedir.
2. La transacción explícita garantiza que el `set_config` y las consultas vayan
   por la misma conexión. Sin ella, un pooler en modo transacción puede
   repartirlas y el ajuste local no aplicaría a nada.
3. El `storeId` se valida como UUID antes de entrar, para que un valor con forma
   rara falle ahí con un mensaje claro y no dentro de una política.

### Y encima: un test de arquitectura

RLS es la red, no la regla. El filtro explícito por `storeId` sigue siendo
obligatorio en cada consulta, y un test recorre los servicios y falla el build
si alguno consulta un modelo con `storeId` sin incluirlo. Sigue el patrón
`.arch-spec.ts` que ya se usa en `micro-ehr` y vive en
`src/prisma/tenant-scope.arch-spec.ts`.

El test lee los modelos de tienda del schema, no de una lista propia, así que
un modelo nuevo queda cubierto solo. Es textual: el filtro tiene que estar
escrito en la llamada misma (`findMany({ where: { storeId, … } })`), no armado
en una variable aparte.

### Lo que RLS no cubre: las claves foráneas

Postgres verifica las claves foráneas **por fuera** de RLS, para que la
integridad no dependa de quién mira. Consecuencia: la base acepta un producto
de la tienda A cuya `category_id` apunte a una categoría de la tienda B. Leído
después con el contexto de A, ese padre "no existe", y si la relación es
obligatoria —el color de una variante— la consulta entera se rompe.

Por eso todo id de otra tabla que entra por un DTO se verifica contra la tienda
antes de escribirse (`shared/tenancy/store-references.ts`). Una
clave foránea compuesta `(store_id, id)` lo cerraría en la base; queda como
mejora.

---

## 5. Por qué la lógica de pedidos sale de plpgsql

En la versión anterior, `create_order` era una función `security definer` en la
base. Vivía ahí porque el navegador llegaba a Postgres directamente y ese era el
único lugar donde la validación no se podía saltar.

Con la API de por medio esa razón desaparece, y quedan las desventajas: la
lógica no se puede testear junto al resto, no versiona con el código y depurarla
exige abrir un cliente de SQL.

Pasa a ser un servicio TypeScript dentro de una transacción, conservando lo que
sí importaba de la versión SQL:

- `SELECT ... FOR UPDATE` sobre las variantes, **ordenado por id** para que dos
  pedidos simultáneos no se bloqueen en cruz;
- revalidación de stock después de tomar el lock;
- precios recalculados desde la base, nunca desde lo que manda el navegador;
- descuento de inventario y creación del pedido en la misma transacción;
- `stock_restored`, para que cancelar dos veces no devuelva el stock dos veces.

Se le agrega idempotencia por header `Idempotency-Key`, que no existía: hoy un
doble clic con la red lenta crea dos pedidos. Ese identificador sí va en header
y no en el path, porque no identifica al inquilino.

---

## 6. Organización del código

```
src/
├── main.ts                  Bootstrap: Fastify, plugins, pipes, Swagger
├── app.module.ts            Módulos, guard global de rate limit, filtro global
├── prisma/                  Cliente de base y forStore
├── shared/                  Config, filtros, decoradores, guards, DTOs comunes
└── modules/<dominio>/
    ├── <dominio>.module.ts
    ├── controllers/         Rutas. Sin lógica de negocio.
    ├── providers/           Servicios. La lógica vive acá.
    └── docs/                Decoradores de Swagger, uno por endpoint
```

Es el layout de `micro-ehr` y `micro-auth`. La carpeta `docs/` por módulo existe
para que los decoradores de Swagger no ahoguen al controlador: un endpoint
documentado en serio son veinte líneas de decoradores sobre tres de código.

Un módulo solo importa de `shared/` y de `prisma/`, nunca de otro módulo de
dominio. Cuando dos dominios necesitan lo mismo, sube a `shared/`.

---

## 7. Decisiones registradas

| Decisión                            | Alternativa descartada       | Por qué                                                                                       |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| Un `store_id` por tabla, base común | Schema o proyecto por tienda | Una migración sirve para todas; por schema hay que aplicarlas N veces y PostgREST no lo lleva |
| Subdominio por tienda               | Path (`/t/slug`)             | Cookies aisladas, mejor SEO, y el dominio propio queda como mejora del plan alto              |
| Cobro manual al principio           | Pasarela desde el día 1      | El modelo de datos de suscripción queda listo; integrar Wompi o Stripe es enchufar después    |
| Prisma                              | Drizzle, SQL crudo           | Es lo que ya se usa en `bookings-api`, el otro API sobre Postgres                             |
| Fastify                             | Express                      | Es la convención de los `micro-*`, con helmet, cors y rate-limit ya resueltos                 |
| Dinero en enteros COP               | Decimal o float              | El peso no usa decimales y un float no puede representar dinero                               |
| Slugs únicos por tienda             | Únicos globales              | Que dos tiendas tengan `vestido-negro` es lo normal, no un conflicto                          |
| `PlatformAdmin` en tabla aparte     | Campo `role` en `users`      | Un booleano en `users` lo puede escribir cualquier `update` mal filtrado                      |

---

## 8. Estado y hoja de ruta

- [x] **Fase 1 — Scaffold.** Nest sobre Fastify, Prisma, Postgres en Docker,
      configuración validada, filtro de excepciones, Swagger, sondas de salud.
      Identidad e inquilinos en el schema.
- [x] **Fase 2 — Schema de dominio.** Catálogo, pedidos y facturación; CHECK de
      integridad, triggers que derivan el `store_id` denormalizado, políticas de
      RLS y permisos para `tienda_app`. Aislamiento verificado contra la base:
      ver § 9.
- [x] **Fase 3 — Auth.** Registro de tienda, login, refresh con rotación y
      detección de reuso, `switch-store`, `JwtAuthGuard` y `StoreRolesGuard`.
      Integrada con el panel de SvelteKit: ver § 10.
- [x] **Fase 4 — Catálogo del panel.** Colores, tallas, categorías, prendas,
      matriz de variantes e inventario bajo `/stores/:storeId/*`. Lo que está
      en uso se oculta o archiva en vez de borrarse. Test de arquitectura del
      filtro por `storeId` y e2e con dos tiendas. Las fotos quedan para la
      fase 8.
- [x] **Fase 5 — Catálogo público.** `/public/:storeSlug/*`: layout, portada,
      listado con filtros, facetas, ficha, relacionadas, favoritos, colecciones,
      sitemap y aviso de reposición. Replica las políticas de lectura de
      Supabase (solo lo publicado y activo). Probado contra la tienda importada.
- [x] **Fase 6 — Pedidos.** Cotización del carrito, creación con bloqueo
      ordenado de variantes, revalidación de stock bajo lock, número por
      tienda, cupón bajo lock e `Idempotency-Key`. Vista pública con token,
      WhatsApp abierto, panel con filtros y cancelación que devuelve el stock
      una sola vez. Un pedido cancelado no se reabre. Reglas de precio en
      `shared/commerce/pricing.ts`, compartidas por cotización y pedido.
- [x] **Fase 7 — Cupones, envíos, ajustes y contenido.** Cupones, zonas,
      avisos de reposición, resumen del panel, ajustes, bloques de portada y
      colecciones. Las fotos se registran por un endpoint puente mientras la
      subida siga en el frontend.
- [x] **Fase 8 — Medios.** La API recibe la foto por multipart, la convierte
      con `sharp` (tres anchos WebP + LQIP) y la guarda en un almacenamiento
      intercambiable: disco local servido por la API, o cualquier bucket
      compatible con S3. Límite de fotos por prenda según el plan. Script
      `db:import-supabase-media` copia las fotos de Supabase Storage. Ver § 11.
- [x] **Fase 9 — Plataforma.** `/platform/*` para quien vende el software
      (tiendas, pagos manuales, plan, suspender), límites del plan aplicados
      al crear, y `GET /stores/:id/subscription` para el aviso del panel.
      Ver § 12.
- [x] **Fase 10 — Enganche del frontend.** El frontend lee y escribe todo
      por la API y reenvía las fotos tal cual llegan del formulario. Sin
      dependencias de Supabase (ver § 10).

---

## 9. El aislamiento, verificado contra la base

La capa 4 no es una intención: se comprobó ejecutando SQL como el rol
`tienda_app` contra dos tiendas sembradas, cada una con un producto. El rol
reporta `rolbypassrls = f`, que es la premisa de todo lo demás.

| #   | Qué se intentó, con el contexto puesto en la tienda A                  | Resultado                                    |
| --- | ---------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Contar productos **sin** fijar contexto                                | 0 filas                                      |
| 2   | Listar productos con contexto en A                                     | solo el de A                                 |
| 3   | Listar productos con contexto en B                                     | solo el de B                                 |
| 4   | `update` del producto de B                                             | `UPDATE 0`                                   |
| 5   | `insert` de un producto marcado como tienda B                          | `new row violates row-level security policy` |
| 6   | `delete` del producto de B                                             | `DELETE 0`                                   |
| 7   | Volver a contar sin contexto                                           | 0 filas                                      |
| 8   | `insert` de una imagen del producto de A, marcada a mano como tienda B | el trigger la reescribe a A                  |
| 9   | `insert` de una imagen colgando de un producto de B                    | `No existe products con id …`                |

El caso 9 mostró una propiedad que no estaba buscada: el trigger que deriva el
`store_id` corre bajo el rol de la aplicación, así que su propia búsqueda del
padre también pasa por RLS. Un padre de otra tienda no es que esté prohibido:
es que no existe para esa sesión. Las defensas se componen en lugar de
limitarse a coexistir.

Los casos 4 y 6 merecen una nota: devuelven `0` en vez de un error. Es lo
correcto para RLS —una fila que no se ve no se puede reportar como existente
sin filtrar justamente lo que se quiere ocultar— pero significa que el código
de aplicación **no puede** interpretar "0 filas afectadas" como "ya estaba
así". Tiene que tratarlo como "no existe o no es mío", y responder 404.

Esta comprobación se hizo a mano una vez y ahora vive en `test/rls.e2e-spec.ts`,
que además recorre las tablas con columna `store_id` y falla si alguna no tiene
RLS activado, forzado y con política.

---

## 10. Cómo se integra con el frontend

El frontend SvelteKit (`personal/shopping-sas`, package `tienda-ropa`) consume esta API
**servidor contra servidor**: el navegador de la clienta nunca la llama.

### Quién pone la cookie

La API devuelve los tokens en el cuerpo de la respuesta y **no** emite cookies.
Tiene que ser así: la API vive en otro dominio, y una cookie suya no llegaría
al navegador. Quien pone la cookie de sesión —httpOnly, en su propio dominio—
es SvelteKit, con lo que recibe de aquí.

El resultado es que el navegador solo ve una cookie opaca. La cookie va
**cifrada** con AES-256-GCM (`SESSION_SECRET` del frontend) y no solo firmada:
una firma impediría falsificarla pero dejaría los tokens legibles para quien la
vea. El access token y el refresh token no aparecen ni en la cookie ni dentro
del HTML serializado.

### Dónde se renueva la sesión

En `hooks.server.ts`, una vez por petición. No en cada `load`, por dos razones:
sucede una sola vez aunque haya varios `load` en paralelo, y deja la cookie
actualizada antes de que nadie use el token.

Si el refresh falla, la sesión se borra en lugar de arrastrarse. Un refresh
rechazado significa que el token fue revocado, que expiró, o que la API detectó
reuso — en los tres casos lo correcto es volver a entrar, no reintentar. Si la
API no respondió, la cookie se conserva: el refresh token sigue siendo bueno.

El frontend se despliega en Vercel, y dos peticiones casi simultáneas con la
misma cookie vencida pueden refrescar en instancias distintas con el mismo
token. Por eso `TokenService.rotate` acepta un token recién rotado durante 30
segundos (`ROTATION_GRACE_MS`) sin tomarlo como reuso. Fuera de esa ventana, o
si la sesión sucesora ya se cerró, sigue revocando toda la cadena. Lo prueba
`test/auth-refresh.e2e-spec.ts`.

### La membresía, en cada carga del panel

`requireAdmin` llama a `GET /auth/me` en cada carga del panel y comprueba que la
tienda de la sesión siga entre las de la cuenta. Es el equivalente de la
consulta a `profiles` de la versión con Supabase: quitarle el acceso a alguien
surte efecto en la siguiente página, no cuando venza su token.

### Migración por rebanadas

El plan era migrar por funciones completas, conviviendo con Supabase. Funcionó
para la autenticación, que no comparte datos con nada. Para el resto no: el
catálogo, el carrito, los pedidos, los cupones y el contenido leen y escriben
las mismas filas. Mover solo el catálogo habría dejado a los pedidos
descontando stock en una base mientras la dueña editaba precios en la otra.

Por eso, después del login, el frontend pasó a la API **de una sola vez**
(2026-09-15, rama `feature/integracion-api`), con los datos ya copiados. Desde
entonces toda lectura y escritura de la tienda va por esta API. Supabase queda
solo como almacenamiento de fotos hasta la fase 8.

En el frontend:

- **Tienda pública** con `STORE_SLUG`: todavía sirve a una sola tienda; la
  resolución por subdominio es trabajo pendiente.
- **Traducción en un solo lugar:** `$lib/server/api/*` lee cada respuesta con
  zod y la traduce a los tipos de dominio que ya usaban las páginas, así el
  cambio casi no tocó componentes.
- **Form actions del panel:** SvelteKit no ejecuta el `load` del layout en las
  form actions, así que cada una exige la sesión por su cuenta (`panelContext`).
  Con Supabase y la llave de servicio, esas acciones no verificaban sesión.
- **IP de la visitante:** viaja en `X-Forwarded-For` en login, refresh, pedidos
  y avisos, para que el límite por IP cuente a cada visitante (§ 3).
- **Idempotencia del checkout:** la clave sale del contenido del envío en
  ventanas de dos minutos, porque el formulario del carrito no genera una.

### Migración de los datos

`scripts/import-supabase.ts` (`pnpm db:import-supabase`) copia la tienda de
Supabase a una tienda de esta API. Se corre primero con `--dry-run`, que hace
todo —incluidos los inserts y la comparación de conteos— y deshace al final.

- **Supabase no se toca:** la lectura va en una transacción `read only` que
  Postgres hace cumplir, no la disciplina del script.
- **Todo o nada:** la escritura es una transacción; si una fila falla o los
  conteos no coinciden con el origen, no queda nada.
- **Los ids se conservan:** fotos, variantes y pedidos siguen apuntando a lo
  mismo, y `--replace` repite la importación con el mismo resultado.
- **Antes de escribir se revisan las reglas que Supabase no exigía** (total del
  pedido, línea = precio × cantidad, ventana del cupón, formato del tono) y se
  devuelve la lista completa de lo que falla, no el primer error de Postgres.
- **Las contraseñas se copian como están.** Supabase Auth guarda bcrypt;
  `PasswordService` lo acepta y `AuthService.login` lo reemplaza por argon2id en
  el primer login correcto, que es el único momento en que se tiene la
  contraseña en claro. bcrypt se lee, nunca se escribe.
- **Los números de pedido siguen desde el último.** En Supabase salían de una
  secuencia global que empezó en 1000; acá son por tienda, y repetir un número
  que una clienta ya tiene en su chat sería confuso.

El origen tiene que ser el pooler de Supabase: la conexión directa solo tiene
IPv6.

### Verificado de punta a punta

| Paso                             | Resultado                                                 |
| -------------------------------- | --------------------------------------------------------- |
| `GET /admin` sin sesión          | 303 a `/admin/login?redirectTo=%2Fadmin`                  |
| Login con contraseña incorrecta  | 401 «Correo o contraseña incorrectos.»                    |
| Login correcto                   | 303 a `/admin`, cookie `tienda_session` httpOnly          |
| `GET /admin` con sesión          | 200, el panel pinta el correo de la cuenta                |
| Tokens en el HTML servido        | ninguno                                                   |
| `POST /admin/logout`             | 303 al login, y el refresh token queda revocado en la API |
| Tienda pública durante todo esto | sigue respondiendo 200                                    |

La primera versión de esta integración se perdió sin subir al cambiar de
equipo. Se rehízo y se volvió a verificar el 2026-09-14 (rama
`feature/integracion-api` del frontend), con dos comprobaciones más: un
`redirectTo` externo en el login termina en `/admin`, y la cookie no contiene
un JWT legible.

### Una trampa de esta máquina

`API_URL` apunta a `127.0.0.1`, no a `localhost`. En Windows, Node resuelve
`localhost` a `::1` antes que a IPv4, y la API escucha en IPv4: con `localhost`
la petición muere con ECONNREFUSED y el login responde «No pudimos conectar con
el servidor», que parece un problema de credenciales y no lo es.

---

## 11. Las fotos

### Por qué un almacenamiento intercambiable

`MediaStorage` es una clase abstracta con dos implementaciones: disco local y
S3. Los servicios piden `MediaStorage` y el entorno decide cuál hay detrás
(`STORAGE_DRIVER`). El driver local existe porque en desarrollo y en un
despliegue de un solo servidor un bucket es fricción sin beneficio; el S3
existe porque con dos instancias cada una tendría su disco, y una foto subida
por una no existiría para la otra. R2, S3 y MinIO hablan el mismo protocolo,
así que una implementación cubre las tres; el adaptador S3 se prueba contra
MinIO (`test/storage-s3.e2e-spec.ts`, se salta sin credenciales).

### El orden de las operaciones

Una foto son tres archivos y una fila, y no hay transacción que abarque los
dos mundos. El orden elegido hace que ningún fallo deje una fila apuntando a
un archivo que no existe:

- **Subir:** convertir (fuera de la transacción, porque `sharp` tarda y no
  hay razón para tener filas bloqueadas), comprobar, escribir los archivos,
  crear la fila. Si crear la fila falla, se borran los archivos.
- **Quitar:** borrar la fila, confirmar, y después borrar los archivos. Si
  borrar los archivos falla, queda un huérfano —espacio perdido— que es mucho
  mejor que lo contrario.
- **Reemplazar la portada:** la vieja se borra al final, con la nueva ya
  guardada.

### Claves

`stores/<storeId>/<carpeta>/<slug>/<marca>-<tamaño>.webp`. La tienda primero,
para que un bucket compartido quede ordenado por inquilino. La marca de tiempo
hace que una clave nunca se reutilice, y por eso el caché puede ser inmutable
(`max-age` de un año). Las fotos migradas desde Supabase conservan su ruta
vieja bajo el prefijo de la tienda: así el script sabe cuáles ya migró.

### Una trampa de compilación

`sharp` exporta con `module.exports =`. Sin `esModuleInterop`, TypeScript
compila `import sharp from 'sharp'` a `sharp.default`, que no existe, y falla
en tiempo de ejecución (SWC, el compilador de `nest build`, sí lo tolera: se
notó en los tests, que usan `ts-jest`). Está activado en `tsconfig.json`.

---

## 12. La plataforma

### Quién entra

`PlatformAdminGuard` consulta `platform_admins` en cada petición, igual que
la membresía. Ningún endpoint escribe esa tabla: se entra con
`pnpm platform:grant-admin --email …`, con acceso a la base. Quien decide
quién ve todas las tiendas no puede ser una petición HTTP.

### RLS no se relaja para la plataforma

`subscriptions` y `payments` están bajo RLS. La plataforma las lee tienda por
tienda con `forStore`, una consulta más por fila del listado. La alternativa
—una política que deje ver todo a un contexto "plataforma"— es exactamente el
agujero que RLS existe para no tener. Con cientos de tiendas el listado
necesitará paginar; hoy tiene un techo de 200.

### Estados

| Estado de la tienda | Quién lo pone            | Tienda pública | Panel        |
| ------------------- | ------------------------ | -------------- | ------------ |
| `TRIAL`             | el registro              | vende          | completo     |
| `ACTIVE`            | un pago, o la plataforma | vende          | completo     |
| `PAST_DUE`          | `reconcile`              | vende          | completo     |
| `SUSPENDED`         | la plataforma, a mano    | 404            | solo lectura |

`PAST_DUE` solo avisa: cortar la venta de una tienda es una decisión de una
persona, no de un cron. Un pago devuelve a `ACTIVE` una tienda en prueba o
vencida, pero no una suspendida: suspender fue una decisión y reactivar es
otra.

Un pago es un asiento que no se edita. El período vigente se extiende hasta el
fin del pago si ese fin es posterior; un pago atrasado no lo acorta.

### El vencimiento

No hay reloj dentro de la API. `reconcile` marca como vencidas las pruebas
terminadas y los períodos pasados; se dispara una vez al día con
`pnpm platform:reconcile` (cron del servidor) o desde la consola. Un mismo
criterio (`isOverdue`) decide el cron y el filtro "vencidas" del listado.

### Límites del plan

`assertWithinPlan` se llama donde se crea lo que el plan acota: prendas,
fotos por prenda y pedidos del mes (este último con las variantes ya
bloqueadas, para que dos pedidos simultáneos no pasen los dos como el último).
Responde 403 con `error: plan_limit` y `details: { limit, max }`, para que el
panel lo distinga de un permiso denegado. Bajar de plan no borra nada: lo que
sobra se queda, y solo se bloquea crear más.

---

## 13. Cuentas y equipo

### Enlaces por correo

Recuperar la contraseña y aceptar una invitación funcionan con un enlace de un
solo uso: 32 bytes aleatorios, y en la base solo su SHA-256 (la misma razón
que `refresh_tokens`). La base del enlace sale de `FRONTEND_URL`, nunca del
`Host` de la petición: armarlo con el host que manda el cliente deja que un
atacante pida el enlace de otra cuenta y lo reciba apuntando a su dominio.

El correo es intercambiable como las fotos: `MAIL_DRIVER=log` lo escribe en el
log de la API (desarrollo, y los e2e lo leen de memoria) y `smtp` lo manda de
verdad.

### Recuperar la contraseña

- `forgot` responde 204 exista o no la cuenta, y el correo sale sin esperarlo:
  esperar haría que una cuenta real tarde lo que tarda el SMTP y una
  inexistente nada, y el cronómetro volvería a enumerar cuentas.
- Solo vale el último enlace pedido, por una hora.
- `reset` marca el enlace como usado en la misma sentencia que lo comprueba
  (dos envíos simultáneos no pasan los dos), levanta el bloqueo por intentos y
  cierra **todas** las sesiones: quien recupera suele hacerlo porque alguien
  más entró.
- `change` exige la contraseña actual y cierra las demás sesiones, no la que
  hizo el cambio.

### Invitaciones

`store_invitations` está bajo RLS: pertenece a la tienda. Aceptar llega sin
contexto, así que el enlace lleva el `storeId` delante del secreto
(`<storeId>.<secreto>`): con él se abre el contexto y se busca por el hash.
El `storeId` no es secreto; el secreto sí.

- Solo la dueña invita, cambia roles y quita miembros (`@Roles('OWNER')`).
- Una invitación nueva al mismo correo anula la pendiente.
- Si el correo ya tiene cuenta, se acepta con **su** contraseña, por el mismo
  camino del login (bloqueo incluido): el enlace prueba acceso al correo, no a
  la cuenta. Si no, se crea la cuenta ahí.
- Cuenta nueva, invitación usada y membresía van en una transacción: una
  invitación que otra pestaña aceptó un instante antes no deja una cuenta
  suelta.

### Nunca sin dueña

Degradar o quitar a una dueña bloquea las filas de todas las dueñas de la
tienda antes de contarlas. Dos dueñas que se degradan la una a la otra a la
vez se serializan, y la segunda ve el resultado de la primera. Quitar a alguien
además cierra sus sesiones atadas a esa tienda.
