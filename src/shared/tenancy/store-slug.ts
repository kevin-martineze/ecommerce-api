/**
 * Formato del subdominio de una tienda. No es cosmético: un punto o una
 * mayúscula es un host que no resuelve. La misma expresión está como CHECK en
 * `stores` y en `store_slug_aliases`, para que ningún otro camino se la salte.
 */
export const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const STORE_SLUG_MESSAGE =
  'El identificador solo admite minúsculas, números y guiones, y debe empezar y terminar con letra o número.';
