import { Prisma } from '@prisma/client';
import { VariantDto } from '@shared/dtos/catalog/variant.dto';

/** Lo que toda respuesta con variantes necesita de su color y su talla. */
export const VARIANT_INCLUDE = {
  color: { select: { id: true, slug: true, name: true, hex: true } },
  size: { select: { id: true, label: true, sortOrder: true } },
} satisfies Prisma.VariantInclude;

export type VariantWithRefs = Prisma.VariantGetPayload<{ include: typeof VARIANT_INCLUDE }>;

export function toVariantDto(variant: VariantWithRefs): VariantDto {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    stock: variant.stock,
    priceOverride: variant.priceOverride,
    active: variant.active,
    color: variant.color,
    size: variant.size,
  };
}
