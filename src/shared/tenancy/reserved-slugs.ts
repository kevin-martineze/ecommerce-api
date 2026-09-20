/**
 * Direcciones que ninguna tienda puede tomar.
 *
 * El slug termina siendo un subdominio, así que estos nombres no son libres:
 * `www.globerce.store` o `api.globerce.store` son la plataforma, no una
 * tienda. El frontend ya se niega a resolverlos como tienda; si la API los
 * dejara registrar, esa tienda nacería inalcanzable —existiría en la base y no
 * habría dirección donde abrirla—.
 *
 * La misma lista está en `shopping-sas/src/lib/tenant.ts`. Agregar uno acá sin
 * agregarlo allá deja una dirección que se puede registrar pero no se puede
 * abrir; al revés, una que el frontend ignora aunque alguien la haya tomado.
 */
export const RESERVED_SLUGS = [
  'www',
  'app',
  'api',
  'admin',
  'panel',
  'plataforma',
  'mail',
  'correo',
  'media',
  'static',
  'assets',
  'cdn',
  'blog',
  'ayuda',
  'soporte',
  'status',
  'globerce',
] as const;
