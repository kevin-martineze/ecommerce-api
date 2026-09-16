import { Injectable } from '@nestjs/common';
import { LOW_STOCK_THRESHOLD } from '@shared/commerce/stock';
import { InventoryDto, InventoryGroupDto } from '@shared/dtos/catalog/inventory.dto';
import { PrismaService } from '@db/prisma.service';

/** Mismo techo que el panel actual. */
const INVENTORY_LIMIT = 400;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Variantes de la más escasa a la más holgada, agrupadas por prenda.
   *
   * Se agrupa conservando el orden en que aparece cada prenda, así la primera
   * es la que tiene la variante más cerca de agotarse: se revisa como quien
   * recorre el perchero empezando por lo que falta.
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
          color: { select: { name: true, hex: true } },
          size: { select: { label: true } },
          product: { select: { id: true, name: true, slug: true, status: true } },
        },
      });

      const groups = new Map<string, InventoryGroupDto>();

      for (const variant of variants) {
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
          colorName: variant.color.name,
          colorHex: variant.color.hex,
          sizeLabel: variant.size.label,
        });

        groups.set(variant.productId, group);
      }

      return { lowStockThreshold: LOW_STOCK_THRESHOLD, groups: [...groups.values()] };
    });
  }
}
