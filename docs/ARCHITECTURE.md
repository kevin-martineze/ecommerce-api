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
`.arch-spec.ts` que ya se usa en `micro-ehr`.

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
- [ ] **Fase 2 — Schema de dominio.** Catálogo, pedidos y facturación; políticas
      de RLS y permisos para `tienda_app`.
- [ ] **Fase 3 — Auth.** Registro de tienda, login, refresh con rotación,
      guards, `switch-store`.
- [ ] **Fase 4 — Catálogo del panel.**
- [ ] **Fase 5 — Catálogo público.**
- [ ] **Fase 6 — Pedidos.**
- [ ] **Fase 7 — Cupones, envíos y ajustes.**
- [ ] **Fase 8 — Medios.** `sharp` a WebP, subida a S3/R2.
- [ ] **Fase 9 — Plataforma.** Tiendas, pagos manuales, límites de plan.
- [ ] **Fase 10 — Enganche del frontend.** Cliente tipado en SvelteKit; se
      retiran `supabase-js` y `@supabase/ssr`.
