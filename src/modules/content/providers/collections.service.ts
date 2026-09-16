import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollectionAdminDto,
  CreateCollectionDto,
  DeleteCollectionResultDto,
  SetCollectionProductDto,
  UpdateCollectionDto,
  UpdateCollectionResultDto,
} from '@shared/dtos/content/collection.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
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
  constructor(private readonly prisma: PrismaService) {}

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
    assertHeroPair(dto.heroImageUrl, dto.heroStoragePath);

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
            heroImageUrl: dto.heroImageUrl ?? null,
            heroStoragePath: dto.heroStoragePath ?? null,
          },
          include: WITH_ITEMS,
        });

        return toDto(collection);
      }),
      { conflict: SLUG_TAKEN },
    );
  }

  /**
   * Si cambia la foto de portada, devuelve la ruta de la anterior.
   *
   * Borrar el archivo le toca a quien lo subió (hoy, el panel). Se borra
   * DESPUÉS de guardar la nueva: si algo falla antes, no se pierde nada.
   */
  update(
    storeId: string,
    collectionId: string,
    dto: UpdateCollectionDto,
  ): Promise<UpdateCollectionResultDto> {
    assertHeroPair(dto.heroImageUrl, dto.heroStoragePath);

    return this.prisma.forStore(storeId, async (tx) => {
      const current = await tx.collection.findFirst({
        where: { id: collectionId, storeId },
        select: { heroStoragePath: true },
      });

      if (!current) {
        throw new NotFoundException(NOT_FOUND);
      }

      const collection = await tx.collection.update({
        where: { id: collectionId, storeId },
        data: {
          name: dto.name ?? undefined,
          description: blankToNull(dto.description),
          active: dto.active ?? undefined,
          sortOrder: dto.sortOrder ?? undefined,
          heroImageUrl: dto.heroImageUrl,
          heroStoragePath: dto.heroStoragePath,
        },
        include: WITH_ITEMS,
      });

      const heroChanged =
        dto.heroStoragePath !== undefined && dto.heroStoragePath !== current.heroStoragePath;

      return {
        collection: toDto(collection),
        replacedHeroStoragePath: heroChanged ? current.heroStoragePath : null,
      };
    });
  }

  /** La portada que la apuntaba vuelve a los textos: `heroCollectionId` es `onDelete: SetNull`. */
  remove(storeId: string, collectionId: string): Promise<DeleteCollectionResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const collection = await tx.collection.findFirst({
        where: { id: collectionId, storeId },
        select: { heroStoragePath: true },
      });

      if (!collection) {
        throw new NotFoundException(NOT_FOUND);
      }

      await tx.collection.delete({ where: { id: collectionId, storeId } });

      return { storagePaths: collection.heroStoragePath ? [collection.heroStoragePath] : [] };
    });
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
}

function assertHeroPair(url: string | null | undefined, path: string | null | undefined): void {
  // Las dos vienen, o ninguna. Y si vienen, las dos con valor o las dos en null.
  if ((url === undefined) !== (path === undefined) || (url === null) !== (path === null)) {
    throw new BadRequestException('La foto necesita URL y ruta juntas.');
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
