/**
 * Slugs y SKU del catálogo.
 *
 * `slugify` y `buildSku` reproducen al carácter las del frontend
 * (`tienda-ropa/src/lib/utils/slug.ts`). No es por estética: los productos que
 * ya existen se migran con su slug y su SKU tal cual, y si la API los generara
 * distinto, una prenda editada después de la migración cambiaría de URL o
 * dejaría de parecerse a lo que dicen sus pedidos viejos.
 */

/** Marcas diacríticas que deja `normalize('NFD')`: la tilde de "é" queda separada de la "e". */
const COMBINING_MARKS = /[̀-ͯ]/g;

export const SLUG_MAX_LENGTH = 80;

/** "Blusa Vera" → "blusa-vera". */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
}

/** Primer tramo del SKU: el slug del producto sin guiones, en mayúsculas y cortado a 10. */
export function skuBase(productSlug: string): string {
  return productSlug.replace(/-/g, '').toUpperCase().slice(0, 10);
}

/**
 * SKU legible a partir del producto y los valores de sus ejes.
 *
 * "vestido-negro-largo" + ["Negro", "M"] → "VESTIDONEG-NEGRO-M".
 * Un producto sin ejes se queda con la base: "VESTIDONEG".
 *
 * Los valores se limpian de acentos y espacios porque un SKU se teclea y se
 * lee en voz alta: "CAFÉ ESPECIAL" no sirve de código, "CAFEESPECIAL" sí.
 */
export function buildSku(productSlug: string, values: readonly string[]): string {
  const partes = values
    .map((valor) =>
      valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase(),
    )
    .filter((parte) => parte.length > 0);

  return [skuBase(productSlug), ...partes].join('-');
}

/**
 * Primer valor libre a partir de `base`: `base`, `base-2`, `base-3`…
 *
 * Recibe los valores ya tomados en lugar de consultarlos: la consulta la hace
 * el servicio dentro de su transacción, y así esto se prueba sin base.
 */
export function firstAvailable(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;

  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}
