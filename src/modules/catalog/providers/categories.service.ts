import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RemovalResultDto } from '@shared/dtos/catalog/catalog-common.dto';
import {
  CategoryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '@shared/dtos/catalog/category.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { firstAvailable, slugify } from '@shared/utils/slug';
import { PrismaService, TenantClient } from '@db/prisma.service';

const WITH_USAGE = { _count: { select: { products: true } } } satisfies Prisma.CategoryInclude;

const NOT_FOUND = 'Esa categoría no existe.';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string, includeHidden: boolean): Promise<CategoryDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const categories = await tx.category.findMany({
        where: { storeId, ...(includeHidden ? {} : { active: true }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: WITH_USAGE,
      });

      return categories.map(toCategoryDto);
    });
  }

  create(storeId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const slug = await availableSlug(tx, storeId, dto.name);

      const category = await tx.category.create({
        data: {
          storeId,
          slug,
          name: dto.name,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active ?? true,
        },
        include: WITH_USAGE,
      });

      return toCategoryDto(category);
    });
  }

  update(storeId: string, categoryId: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const category = await tx.category.update({
          where: { id: categoryId, storeId },
          // `?? undefined`: null en un campo opcional es "no lo toques". Ver ColorsService.update.
          data: {
            name: dto.name ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
            active: dto.active ?? undefined,
          },
          include: WITH_USAGE,
        });

        return toCategoryDto(category);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Borra la categoría SIEMPRE, aunque tenga productos.
   *
   * No se oculta como un color o una variación en uso, y es deliberado: igual que
   * en la versión con Supabase, los productos apuntan a la categoría con
   * `onDelete: SetNull`, así que borrarla las deja sin categoría y nada más.
   * Un color, en cambio, es parte de lo que se vendió.
   */
  remove(storeId: string, categoryId: string): Promise<RemovalResultDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        await tx.category.delete({ where: { id: categoryId, storeId } });

        return { hidden: false };
      }),
      { notFound: NOT_FOUND },
    );
  }
}

/** El nombre manda: el slug se deriva de él y se numera si ya existe en la tienda. */
async function availableSlug(tx: TenantClient, storeId: string, name: string): Promise<string> {
  const base = slugify(name) || 'sin-nombre';

  const existing = await tx.category.findMany({
    where: { storeId, slug: { startsWith: base } },
    select: { slug: true },
  });

  return firstAvailable(base, new Set(existing.map((row) => row.slug)));
}

function toCategoryDto(
  category: Prisma.CategoryGetPayload<{ include: typeof WITH_USAGE }>,
): CategoryDto {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    parentId: category.parentId,
    sortOrder: category.sortOrder,
    active: category.active,
    usageCount: category._count.products,
  };
}
