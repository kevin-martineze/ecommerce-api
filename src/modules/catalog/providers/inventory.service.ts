import { Injectable } from '@nestjs/common';
import { LOW_STOCK_THRESHOLD } from '@shared/commerce/stock';
import { InventoryDto, InventoryGroupDto } from '@shared/dtos/catalog/inventory.dto';
import { PrismaService } from '@db/prisma.service';

import { VARIANT_INCLUDE, variantLabel, variantValues } from './variant-mapping';

/** Mismo techo que el panel actual. */
const INVENTORY_LIMIT = 400;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Variantes de la más escasa a la más holgada, agrupadas por producto.
   *
   * Se agrupa conservando el orden en que aparece cada producto, así la primera
   * es la que tiene la variante más cerca de agotarse: se revisa como quien
   * recorre el catálogo empezando por lo que falta.
   */
  list(storeId: string, onlyLowStock: boolean): Promise<InventoryDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const variants = await tx.variant.findMany({
        where: {
          storeId,
          ...(onlyLowStock ? { stock: { lte: LOW_STOCK_THRESHOLD } } : {}),
        },
        orderBy: [{ stock: 'asc' }, { id: 'asc' }],
        take: INVENTORY_LIMIT,
        include: {
          ...VARIANT_INCLUDE,
          product: { select: { id: true, name: true, slug: true, status: true } },
        },
      });

      const groups = new Map<string, InventoryGroupDto>();

      for (const variant of variants) {
        const values = variantValues(variant);
        const group = groups.get(variant.productId) ?? {
          productId: variant.product.id,
          name: variant.product.name,
          slug: variant.product.slug,
          status: variant.product.status,
          variants: [],
        };

        group.variants.push({
          id: variant.id,
          sku: variant.sku,
          stock: variant.stock,
          active: variant.active,
          label: variantLabel(values),
          // El primer valor que traiga tono: en la ropa es el color, y en un
          // producto sin colores no hay ninguno y se pinta sin muestra.
          hex: values.find((valor) => valor.hex !== null)?.hex ?? null,
        });

        groups.set(variant.productId, group);
      }

      return { lowStockThreshold: LOW_STOCK_THRESHOLD, groups: [...groups.values()] };
    });
  }
}
