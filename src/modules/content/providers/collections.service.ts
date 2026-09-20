import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollectionAdminDto,
  CreateCollectionDto,
  SetCollectionProductDto,
  UpdateCollectionDto,
} from '@shared/dtos/content/collection.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { imageObjectKeys, imageObjects, newStoragePath, processImage } from '@shared/media/images';
import { Upload } from '@shared/media/upload';
import { MediaStorage } from '@shared/storage/media-storage';
import { assertCollectionInStore, assertProductInStore } from '@shared/tenancy/store-references';
import { firstAvailable, slugify } from '@shared/utils/slug';
import { blankToNull } from '@shared/utils/text';
import { PrismaService, TenantClient } from '@db/prisma.service';

const WITH_ITEMS = {
  items: {
    orderBy: [{ sortOrder: 'asc' }, { product: { name: 'asc' } }],
    include: { product: { select: { name: true, slug: true } } },
  },
} satisfies Prisma.CollectionInclude;

type CollectionWithItems = Prisma.CollectionGetPayload<{ include: typeof WITH_ITEMS }>;

const NOT_FOUND = 'Esa colección no existe.';
const SLUG_TAKEN = 'Ya existe una colección con ese slug.';

/** Colecciones editoriales: foto de portada y prendas etiquetadas sobre ella. */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
  ) {}

  list(storeId: string): Promise<CollectionAdminDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const collections = await tx.collection.findMany({
        where: { storeId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: WITH_ITEMS,
      });

      return collections.map(toDto);
    });
  }

  create(storeId: string, dto: CreateCollectionDto): Promise<CollectionAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const slug = dto.slug ?? (await availableSlug(tx, storeId, dto.name));

        const collection = await tx.collection.create({
          data: {
            storeId,
            slug,
            name: dto.name,
            description: blankToNull(dto.description) ?? null,
            active: dto.active ?? true,
            sortOrder: dto.sortOrder ?? 0,
          },
          include: WITH_ITEMS,
        });

        return toDto(collection);
      }),
      { conflict: SLUG_TAKEN },
    );
  }

  update(
    storeId: string,
    collectionId: string,
    dto: UpdateCollectionDto,
  ): Promise<CollectionAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const collection = await tx.collection.update({
          where: { id: collectionId, storeId },
          data: {
            name: dto.name ?? undefined,
            description: blankToNull(dto.description),
            active: dto.active ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
          },
          include: WITH_ITEMS,
        });

        return toDto(collection);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Cambia la foto de portada.
   *
   * La foto se convierte antes de abrir la transacción y los archivos nuevos
   * se escriben dentro, tras comprobar que la colección existe. La anterior se
   * borra al final, ya con la nueva guardada: un fallo a medias no pierde nada.
   */
  async setHero(
    storeId: string,
    collectionId: string,
    upload: Upload,
  ): Promise<CollectionAdminDto> {
    const processed = await processImage(upload.buffer);
    let storagePath: string | null = null;

    let previous: string | null = null;
    let collection: CollectionAdminDto;

    try {
      collection = await this.prisma.forStore(storeId, async (tx) => {
        const current = await tx.collection.findFirst({
          where: { id: collectionId, storeId },
          select: { slug: true, heroStoragePath: true },
        });

        if (!current) {
          throw new NotFoundException(NOT_FOUND);
        }

        previous = current.heroStoragePath;
        storagePath = newStoragePath(storeId, 'collections', current.slug);

        await this.storage.put(imageObjects(storagePath, processed));

        const updated = await tx.collection.update({
          where: { id: collectionId, storeId },
          data: {
            heroImageUrl: this.storage.publicUrl(`${storagePath}-full.webp`),
            heroStoragePath: storagePath,
          },
          include: WITH_ITEMS,
        });

        return toDto(updated);
      });
    } catch (error) {
      if (storagePath) {
        await this.discard(imageObjectKeys(storagePath));
      }

      throw error;
    }

    if (previous) {
      await this.discard(imageObjectKeys(previous));
    }

    return collection;
  }

  /** La portada que la apuntaba vuelve a los textos: `heroCollectionId` es `onDelete: SetNull`. */
  async remove(storeId: string, collectionId: string): Promise<void> {
    const collection = await this.prisma.forStore(storeId, async (tx) => {
      const found = await tx.collection.findFirst({
        where: { id: collectionId, storeId },
        select: { heroStoragePath: true },
      });

      if (!found) {
        throw new NotFoundException(NOT_FOUND);
      }

      await tx.collection.delete({ where: { id: collectionId, storeId } });

      return found;
    });

    if (collection.heroStoragePath) {
      await this.discard(imageObjectKeys(collection.heroStoragePath));
    }
  }

  /** Etiqueta una prenda en la colección, o mueve su punto si ya estaba. */
  setProduct(
    storeId: string,
    collectionId: string,
    productId: string,
    dto: SetCollectionProductDto,
  ): Promise<CollectionAdminDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      await assertCollectionInStore(tx, storeId, collectionId);
      await assertProductInStore(tx, storeId, productId);

      await tx.collectionProduct.upsert({
        where: { collectionId_productId: { collectionId, productId } },
        create: {
          storeId,
          collectionId,
          productId,
          sortOrder: dto.sortOrder ?? 0,
          hotspotX: dto.hotspotX ?? null,
          hotspotY: dto.hotspotY ?? null,
        },
        update: {
          sortOrder: dto.sortOrder ?? undefined,
          hotspotX: dto.hotspotX,
          hotspotY: dto.hotspotY,
        },
      });

      const collection = await tx.collection.findFirst({
        where: { id: collectionId, storeId },
        include: WITH_ITEMS,
      });

      if (!collection) {
        throw new NotFoundException(NOT_FOUND);
      }

      return toDto(collection);
    });
  }

  removeProduct(storeId: string, collectionId: string, productId: string): Promise<void> {
    return this.prisma.forStore(storeId, async (tx) => {
      const { count } = await tx.collectionProduct.deleteMany({
        where: { storeId, collectionId, productId },
      });

      if (count === 0) {
        throw new NotFoundException('Esa prenda no está en la colección.');
      }
    });
  }

  /** Borra archivos sin frenar lo que ya se confirmó en la base. Un huérfano es mejor que una fila rota. */
  private async discard(keys: string[]): Promise<void> {
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

async function availableSlug(tx: TenantClient, storeId: string, name: string): Promise<string> {
  const base = slugify(name) || 'sin-nombre';

  const existing = await tx.collection.findMany({
    where: { storeId, slug: { startsWith: base } },
    select: { slug: true },
  });

  return firstAvailable(base, new Set(existing.map((row) => row.slug)));
}

function toDto(collection: CollectionWithItems): CollectionAdminDto {
  return {
    id: collection.id,
    slug: collection.slug,
    name: collection.name,
    description: collection.description,
    heroImageUrl: collection.heroImageUrl,
    heroStoragePath: collection.heroStoragePath,
    active: collection.active,
    sortOrder: collection.sortOrder,
    createdAt: collection.createdAt,
    items: collection.items.map((item) => ({
      productId: item.productId,
      productName: item.product.name,
      productSlug: item.product.slug,
      sortOrder: item.sortOrder,
      hotspotX: item.hotspotX?.toNumber() ?? null,
      hotspotY: item.hotspotY?.toNumber() ?? null,
    })),
  };
}
