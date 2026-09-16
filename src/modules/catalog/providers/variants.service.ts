import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeleteVariantResultDto,
  GenerateVariantsDto,
  GenerateVariantsResultDto,
  UpdateVariantDto,
  VariantDto,
} from '@shared/dtos/catalog/variant.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { findColorsAndSizesInStore } from '@shared/tenancy/store-references';
import { buildSku, firstAvailable, skuBase } from '@shared/utils/slug';
import { PrismaService } from '@db/prisma.service';

import { toVariantDto, VARIANT_INCLUDE } from './variant-mapping';

const NOT_FOUND = 'Esa variante no existe.';

@Injectable()
export class VariantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea las combinaciones color × talla que le falten a la prenda.
   *
   * Nunca borra: una variante existente puede estar dentro de un pedido. Pedir
   * la misma matriz dos veces crea cero la segunda.
   */
  generate(
    storeId: string,
    productId: string,
    dto: GenerateVariantsDto,
  ): Promise<GenerateVariantsResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
        select: { slug: true, variants: { select: { colorId: true, sizeId: true } } },
      });

      if (!product) {
        throw new NotFoundException('Esa prenda no existe.');
      }

      const { colors, sizes } = await findColorsAndSizesInStore(
        tx,
        storeId,
        dto.colorIds,
        dto.sizeIds,
      );

      const existing = new Set(product.variants.map((v) => `${v.colorId}:${v.sizeId}`));

      const missing = colors.flatMap((color) =>
        sizes
          .filter((size) => !existing.has(`${color.id}:${size.id}`))
          .map((size) => ({ color, size })),
      );

      if (missing.length === 0) {
        return { created: 0 };
      }

      // El SKU se corta a 10 caracteres del producto, así que dos prendas que
      // empiezan igual ("vestido-negro-largo", "vestido-negro-corto") generan el
      // mismo. En el panel actual eso tumbaba la matriz entera con un error
      // genérico; acá el repetido se numera, como los slugs.
      const takenSkus = await tx.variant.findMany({
        where: { storeId, sku: { startsWith: `${skuBase(product.slug)}-` } },
        select: { sku: true },
      });

      const taken = new Set(takenSkus.flatMap((row) => (row.sku ? [row.sku] : [])));

      const { count } = await tx.variant.createMany({
        data: missing.map(({ color, size }) => {
          const sku = firstAvailable(buildSku(product.slug, color.slug, size.label), taken);

          taken.add(sku);

          return {
            // El trigger `variants_store_id` lo reescribe con el de la prenda
            // de todos modos; Prisma lo exige porque la columna no tiene default.
            storeId,
            productId,
            colorId: color.id,
            sizeId: size.id,
            sku,
            stock: dto.defaultStock ?? 0,
          };
        }),
      });

      return { created: count };
    });
  }

  update(storeId: string, variantId: string, dto: UpdateVariantDto): Promise<VariantDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const variant = await tx.variant.update({
          where: { id: variantId, storeId },
          data: {
            // En stock y active null es "no lo toques"; en priceOverride null
            // es "volver al precio base", así que ese pasa tal cual.
            stock: dto.stock ?? undefined,
            priceOverride: dto.priceOverride,
            active: dto.active ?? undefined,
          },
          include: VARIANT_INCLUDE,
        });

        return toVariantDto(variant);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Borra la variante, o la desactiva en cero si ya se vendió.
   *
   * Mismo criterio que con la prenda: la línea de pedido sobrevive al borrado
   * porque guarda copia, pero perdería el enlace a la variante.
   */
  remove(storeId: string, variantId: string): Promise<DeleteVariantResultDto> {
    return this.prisma.forStore<DeleteVariantResultDto>(storeId, async (tx) => {
      const variant = await tx.variant.findFirst({
        where: { id: variantId, storeId },
        select: { _count: { select: { orderItems: true } } },
      });

      if (!variant) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (variant._count.orderItems > 0) {
        await tx.variant.update({
          where: { id: variantId, storeId },
          data: { active: false, stock: 0 },
        });

        return { result: 'deactivated' };
      }

      await tx.variant.delete({ where: { id: variantId, storeId } });

      return { result: 'deleted' };
    });
  }
}
