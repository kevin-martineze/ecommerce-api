import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateProductDto,
  DeleteProductResultDto,
  ProductDetailDto,
  ProductListItemDto,
  UpdateProductDto,
} from '@shared/dtos/catalog/product.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { imageObjectKeys } from '@shared/media/images';
import { assertCategoryInStore } from '@shared/tenancy/store-references';
import { firstAvailable, slugify } from '@shared/utils/slug';
import { blankToNull } from '@shared/utils/text';
import { PrismaService, TenantClient } from '@db/prisma.service';

import { ProductImagesService } from './product-images.service';
import { toVariantDto, VARIANT_INCLUDE } from './variant-mapping';

/** Mismo techo que el panel actual. Una tienda de ropa pequeña no se acerca. */
const LIST_LIMIT = 200;

const NOT_FOUND = 'Esa prenda no existe.';
const SLUG_TAKEN = 'Ya existe una prenda con ese slug.';

const LIST_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: { select: { stock: true } },
  images: { select: { urlThumb: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

const DETAIL_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' } },
  variants: {
    include: VARIANT_INCLUDE,
    orderBy: [{ color: { sortOrder: 'asc' } }, { size: { sortOrder: 'asc' } }],
  },
} satisfies Prisma.ProductInclude;

type ProductWithDetail = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ProductImagesService,
  ) {}

  list(storeId: string, search: string | undefined): Promise<ProductListItemDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const products = await tx.product.findMany({
        where: {
          storeId,
          ...(search ? { name: { contains: search, mode: Prisma.QueryMode.insensitive } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
        include: LIST_INCLUDE,
      });

      return products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        status: product.status,
        featured: product.featured,
        basePrice: product.basePrice,
        compareAtPrice: product.compareAtPrice,
        category: product.category,
        variantCount: product.variants.length,
        totalStock: product.variants.reduce((sum, variant) => sum + variant.stock, 0),
        thumbnailUrl: product.images[0]?.urlThumb ?? null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      }));
    });
  }

  get(storeId: string, productId: string): Promise<ProductDetailDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
        include: DETAIL_INCLUDE,
      });

      if (!product) {
        throw new NotFoundException(NOT_FOUND);
      }

      return toDetailDto(product);
    });
  }

  create(storeId: string, dto: CreateProductDto): Promise<ProductDetailDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        if (dto.categoryId) {
          await assertCategoryInStore(tx, storeId, dto.categoryId);
        }

        const compareAtPrice = normalizeCompareAt(dto.compareAtPrice);

        assertCompareAtAbove(dto.basePrice, compareAtPrice);

        // Un slug escrito a mano se respeta y, si choca, es 409. Uno derivado
        // del nombre se numera: nadie lo eligió, así que no hay a quién decirle
        // que ya estaba tomado.
        const slug = dto.slug ?? (await availableSlug(tx, storeId, dto.name));

        const product = await tx.product.create({
          data: {
            storeId,
            slug,
            name: dto.name,
            description: blankToNull(dto.description) ?? null,
            material: blankToNull(dto.material) ?? null,
            care: blankToNull(dto.care) ?? null,
            categoryId: dto.categoryId ?? null,
            basePrice: dto.basePrice,
            compareAtPrice,
            status: dto.status ?? 'DRAFT',
            featured: dto.featured ?? false,
          },
          include: DETAIL_INCLUDE,
        });

        return toDetailDto(product);
      }),
      { conflict: SLUG_TAKEN },
    );
  }

  update(storeId: string, productId: string, dto: UpdateProductDto): Promise<ProductDetailDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const current = await tx.product.findFirst({
          where: { id: productId, storeId },
          select: { basePrice: true, compareAtPrice: true },
        });

        if (!current) {
          throw new NotFoundException(NOT_FOUND);
        }

        if (dto.categoryId) {
          await assertCategoryInStore(tx, storeId, dto.categoryId);
        }

        // La regla del precio tachado se evalúa sobre cómo QUEDA la prenda, no
        // sobre lo que vino: subir solo el precio base por encima del tachado
        // existente también tiene que rechazarse.
        const basePrice = dto.basePrice ?? current.basePrice;
        const compareAtPrice =
          dto.compareAtPrice === undefined
            ? current.compareAtPrice
            : normalizeCompareAt(dto.compareAtPrice);

        assertCompareAtAbove(basePrice, compareAtPrice);

        const product = await tx.product.update({
          where: { id: productId, storeId },
          data: {
            // `?? undefined` en columnas obligatorias: null es "no lo toques".
            // En las opcionales, null sí significa vaciar.
            name: dto.name ?? undefined,
            slug: dto.slug ?? undefined,
            description: blankToNull(dto.description),
            material: blankToNull(dto.material),
            care: blankToNull(dto.care),
            categoryId: dto.categoryId,
            basePrice,
            compareAtPrice,
            status: dto.status ?? undefined,
            featured: dto.featured ?? undefined,
          },
          include: DETAIL_INCLUDE,
        });

        return toDetailDto(product);
      }),
      { conflict: SLUG_TAKEN },
    );
  }

  /**
   * Borra la prenda, o la archiva si ya se vendió.
   *
   * Técnicamente se podría borrar siempre: las líneas de pedido guardan copia
   * de nombre, color, talla y precio, y su `productId` pasa a null. Pero ese
   * enlace es lo que deja ir de un pedido a la prenda y contar ventas por
   * prenda. Archivar la saca de la tienda igual y no rompe nada de eso.
   *
   * Los archivos de las fotos se borran después de confirmar la transacción y
   * solo si de verdad se borró la fila.
   */
  async remove(storeId: string, productId: string): Promise<DeleteProductResultDto> {
    const outcome = await this.prisma.forStore(storeId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
        select: {
          images: { select: { storagePath: true } },
          _count: { select: { orderItems: true } },
        },
      });

      if (!product) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (product._count.orderItems > 0) {
        await tx.product.update({
          where: { id: productId, storeId },
          data: { status: 'ARCHIVED' },
        });

        return { result: 'archived' as const, storagePaths: [] };
      }

      await tx.product.delete({ where: { id: productId, storeId } });

      return {
        result: 'deleted' as const,
        storagePaths: product.images.map((image) => image.storagePath),
      };
    });

    await this.images.discard(outcome.storagePaths.flatMap(imageObjectKeys));

    return { result: outcome.result };
  }
}

async function availableSlug(tx: TenantClient, storeId: string, name: string): Promise<string> {
  const base = slugify(name) || 'sin-nombre';

  const existing = await tx.product.findMany({
    where: { storeId, slug: { startsWith: base } },
    select: { slug: true },
  });

  return firstAvailable(base, new Set(existing.map((row) => row.slug)));
}

/** 0 y null significan "sin precio tachado", igual que en el formulario del panel. */
function normalizeCompareAt(value: number | null | undefined): number | null {
  return value ? value : null;
}

function assertCompareAtAbove(basePrice: number, compareAtPrice: number | null): void {
  if (compareAtPrice !== null && compareAtPrice <= basePrice) {
    throw new BadRequestException('El precio tachado debe ser mayor que el precio actual.');
  }
}

function toDetailDto(product: ProductWithDetail): ProductDetailDto {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    material: product.material,
    care: product.care,
    categoryId: product.categoryId,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    status: product.status,
    featured: product.featured,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    images: product.images.map((image) => ({
      id: image.id,
      colorId: image.colorId,
      storagePath: image.storagePath,
      urlFull: image.urlFull,
      urlCard: image.urlCard,
      urlThumb: image.urlThumb,
      lqip: image.lqip,
      alt: image.alt,
      sortOrder: image.sortOrder,
    })),
    variants: product.variants.map(toVariantDto),
  };
}
