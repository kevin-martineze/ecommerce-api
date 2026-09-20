import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProductImage } from '@prisma/client';
import { assertWithinPlan } from '@shared/billing/plan-limits';
import { ProductImageDto } from '@shared/dtos/catalog/product.dto';
import { imageObjectKeys, imageObjects, newStoragePath, processImage } from '@shared/media/images';
import { Upload } from '@shared/media/upload';
import { MediaStorage } from '@shared/storage/media-storage';
import { assertOptionValueInProduct } from '@shared/tenancy/store-references';
import { blankToNull } from '@shared/utils/text';
import { PrismaService } from '@db/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fotos de prenda: subir, ordenar y quitar. */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
  ) {}

  /**
   * Procesa la foto, la guarda en el almacenamiento y la registra.
   *
   * El orden importa: la imagen se convierte ANTES de abrir la transacción,
   * porque `sharp` tarda y no hay razón para tener filas bloqueadas mientras
   * tanto. Los archivos se escriben dentro de la transacción, después de las
   * comprobaciones; si el registro falla, se borran.
   */
  async upload(storeId: string, productId: string, upload: Upload): Promise<ProductImageDto> {
    const optionValueId = upload.fields.optionValueId?.trim() || null;
    const alt = blankToNull(upload.fields.alt?.trim());

    if (optionValueId && !UUID.test(optionValueId)) {
      throw new BadRequestException('El color no es válido.');
    }

    const processed = await processImage(upload.buffer);
    let storagePath: string | null = null;

    try {
      return await this.prisma.forStore(storeId, async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, storeId },
          select: { slug: true, name: true, _count: { select: { images: true } } },
        });

        if (!product) {
          throw new NotFoundException('Ese producto no existe.');
        }

        if (optionValueId) {
          await assertOptionValueInProduct(tx, storeId, productId, optionValueId);
        }

        await assertWithinPlan(tx, storeId, 'maxImagesPerProduct', product._count.images);

        storagePath = newStoragePath(storeId, 'products', product.slug);

        await this.storage.put(imageObjects(storagePath, processed));

        const image = await tx.productImage.create({
          data: {
            storeId,
            productId,
            optionValueId,
            storagePath,
            urlFull: this.storage.publicUrl(`${storagePath}-full.webp`),
            urlCard: this.storage.publicUrl(`${storagePath}-card.webp`),
            urlThumb: this.storage.publicUrl(`${storagePath}-thumb.webp`),
            lqip: processed.lqip,
            alt: alt ?? product.name,
            // La foto nueva va al final: la principal no cambia por subir otra.
            sortOrder: product._count.images,
          },
        });

        return toImageDto(image);
      });
    } catch (error) {
      if (storagePath) {
        await this.discard(imageObjectKeys(storagePath));
      }

      throw error;
    }
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

  /** La fila primero y el archivo después: nunca queda una prenda apuntando a una foto que no está. */
  async remove(storeId: string, imageId: string): Promise<void> {
    const image = await this.prisma.forStore(storeId, async (tx) => {
      const found = await tx.productImage.findFirst({
        where: { id: imageId, storeId },
        select: { storagePath: true },
      });

      if (!found) {
        throw new NotFoundException('Esa foto no existe.');
      }

      await tx.productImage.delete({ where: { id: imageId, storeId } });

      return found;
    });

    await this.discard(imageObjectKeys(image.storagePath));
  }

  /**
   * Borra archivos sin frenar la operación que ya se confirmó en la base.
   *
   * Si falla, queda un archivo huérfano —espacio perdido— que es mucho mejor
   * que una fila apuntando a una foto que ya no está.
   */
  async discard(keys: string[]): Promise<void> {
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn(
        `No se pudieron borrar ${keys.length} archivos del almacenamiento: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function toImageDto(image: ProductImage): ProductImageDto {
  return {
    id: image.id,
    optionValueId: image.optionValueId,
    storagePath: image.storagePath,
    urlFull: image.urlFull,
    urlCard: image.urlCard,
    urlThumb: image.urlThumb,
    lqip: image.lqip,
    alt: image.alt,
    sortOrder: image.sortOrder,
  };
}
