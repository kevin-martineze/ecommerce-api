import { Prisma } from '@prisma/client';
import { ProductCardDto } from '@shared/dtos/storefront/product.dto';

/**
 * Lo que una tarjeta de producto necesita, y nada más: es la consulta que más se
 * repite en la tienda (listado, portada, relacionados, favoritos, colecciones).
 *
 * Solo variantes ACTIVAS. Es la misma regla que la política `variants_read` de
 * la versión con Supabase: una variante desactivada no existe para la
 * visitante, ni su color ni su stock.
 */
export const CARD_INCLUDE = {
  images: {
    select: { urlCard: true, urlThumb: true, lqip: true, alt: true },
    orderBy: { sortOrder: 'asc' },
    take: 2,
  },
  variants: {
    where: { active: true },
    select: {
      stock: true,
      optionValues: {
        select: {
          value: {
            select: {
              value: true,
              hex: true,
              sortOrder: true,
              option: { select: { name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

export type ProductWithCard = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

/**
 * Las muestras de color de la tarjeta.
 *
 * Se recogen de CUALQUIER eje cuyos valores traigan tono: la ropa lo llama
 * "Color" pero una tienda de pintura puede llamarlo "Acabado", y la tarjeta no
 * tiene por qué saber cómo se llama. Se deduplican por nombre del valor,
 * porque dos "Rojo" de ejes distintos son el mismo punto para quien mira.
 */
interface Muestra {
  value: string;
  hex: string;
  orden: number;
}

export function toProductCard(product: ProductWithCard): ProductCardDto {
  const muestras = new Map<string, Muestra>();

  for (const variant of product.variants) {
    for (const { value } of variant.optionValues) {
      if (value.hex === null || muestras.has(value.value)) continue;

      muestras.set(value.value, {
        value: value.value,
        hex: value.hex,
        orden: value.option.sortOrder * 1000 + value.sortOrder,
      });
    }
  }

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    images: product.images.map((image) => ({
      urlCard: image.urlCard,
      urlThumb: image.urlThumb,
      lqip: image.lqip,
      alt: image.alt,
    })),
    swatches: [...muestras.values()]
      .sort((uno, otro) => uno.orden - otro.orden || uno.value.localeCompare(otro.value))
      .map(({ value, hex }) => ({ value, hex })),
    inStock: product.variants.some((variant) => variant.stock > 0),
  };
}

/** Desempate estable: sin él, dos productos con el mismo precio pueden saltar de página. */
export const NEWEST_FIRST: Prisma.ProductOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];
