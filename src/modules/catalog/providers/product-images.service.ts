import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductImage } from '@prisma/client';
import { ProductImageDto } from '@shared/dtos/catalog/product.dto';
import {
  AddProductImageDto,
  DeleteProductImageResultDto,
} from '@shared/dtos/catalog/product-image.dto';
import { assertColorInStore, assertProductInStore } from '@shared/tenancy/store-references';
import { blankToNull } from '@shared/utils/text';
import { PrismaService } from '@db/prisma.service';

/**
 * Fotos de prenda: registrar, ordenar y quitar.
 *
 * Los archivos no pasan por aquí todavía (ver AddProductImageDto). Por eso
 * quitar una foto devuelve su ruta: quien la subió es quien la borra.
 */
@Injectable()
export class ProductImagesService {
  constructor(private readonly prisma: PrismaService) {}

  add(storeId: string, productId: string, dto: AddProductImageDto): Promise<ProductImageDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      await assertProductInStore(tx, storeId, productId);

      if (dto.colorId) {
        await assertColorInStore(tx, storeId, dto.colorId);
      }

      // La foto nueva va al final: la principal no cambia por subir otra.
      const existing = await tx.productImage.count({ where: { storeId, productId } });

      const image = await tx.productImage.create({
        data: {
          storeId,
          productId,
          colorId: dto.colorId ?? null,
          storagePath: dto.storagePath,
          urlFull: dto.urlFull,
          urlCard: dto.urlCard,
          urlThumb: dto.urlThumb,
          lqip: dto.lqip ?? null,
          alt: blankToNull(dto.alt) ?? null,
          sortOrder: existing,
        },
      });

      return toImageDto(image);
    });
  }

  /**
   * Reordena las fotos de una prenda. La primera es la principal.
   *
   * Exige la lista COMPLETA: un orden parcial dejaría dos fotos con el mismo
   * `sortOrder` y la principal dependería de cómo desempate la base.
   */
  reorder(storeId: string, productId: string, imageIds: string[]): Promise<ProductImageDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const images = await tx.productImage.findMany({
        where: { storeId, productId },
        select: { id: true },
      });

      const current = new Set(images.map((image) => image.id));
      const requested = new Set(imageIds);

      if (
        requested.size !== imageIds.length ||
        requested.size !== current.size ||
        imageIds.some((id) => !current.has(id))
      ) {
        throw new BadRequestException(
          'La lista tiene que incluir todas las fotos de la prenda, una vez cada una.',
        );
      }

      for (const [index, id] of imageIds.entries()) {
        await tx.productImage.update({ where: { id, storeId }, data: { sortOrder: index } });
      }

      const ordered = await tx.productImage.findMany({
        where: { storeId, productId },
        orderBy: { sortOrder: 'asc' },
      });

      return ordered.map(toImageDto);
    });
  }

  remove(storeId: string, imageId: string): Promise<DeleteProductImageResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const image = await tx.productImage.findFirst({
        where: { id: imageId, storeId },
        select: { storagePath: true },
      });

      if (!image) {
        throw new NotFoundException('Esa foto no existe.');
      }

      await tx.productImage.delete({ where: { id: imageId, storeId } });

      return { storagePath: image.storagePath };
    });
  }
}

function toImageDto(image: ProductImage): ProductImageDto {
  return {
    id: image.id,
    colorId: image.colorId,
    storagePath: image.storagePath,
    urlFull: image.urlFull,
    urlCard: image.urlCard,
    urlThumb: image.urlThumb,
    lqip: image.lqip,
    alt: image.alt,
    sortOrder: image.sortOrder,
  };
}
