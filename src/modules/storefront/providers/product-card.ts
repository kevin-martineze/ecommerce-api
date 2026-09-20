import { Prisma } from '@prisma/client';
import { ProductCardDto } from '@shared/dtos/storefront/product.dto';

/**
 * Lo que una tarjeta de prenda necesita, y nada más: es la consulta que más se
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
      color: { select: { id: true, slug: true, name: true, hex: true, sortOrder: true } },
    },
  },
} satisfies Prisma.ProductInclude;

export type ProductWithCard = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

type CardColor = ProductWithCard['variants'][number]['color'];

export function toProductCard(product: ProductWithCard): ProductCardDto {
  const colors = new Map<string, CardColor>();

  for (const variant of product.variants) {
    colors.set(variant.color.id, variant.color);
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
    colors: [...colors.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id, slug, name, hex }) => ({ id, slug, name, hex })),
    inStock: product.variants.some((variant) => variant.stock > 0),
  };
}

/** Desempate estable: sin él, dos prendas con el mismo precio pueden saltar de página. */
export const NEWEST_FIRST: Prisma.ProductOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];
