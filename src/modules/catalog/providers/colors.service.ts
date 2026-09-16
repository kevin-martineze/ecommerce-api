import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RemovalResultDto } from '@shared/dtos/catalog/catalog-common.dto';
import { ColorDto, CreateColorDto, UpdateColorDto } from '@shared/dtos/catalog/color.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { firstAvailable, slugify } from '@shared/utils/slug';
import { PrismaService, TenantClient } from '@db/prisma.service';

const WITH_USAGE = { _count: { select: { variants: true } } } satisfies Prisma.ColorInclude;

const NOT_FOUND = 'Ese color no existe.';

@Injectable()
export class ColorsService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string, includeHidden: boolean): Promise<ColorDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const colors = await tx.color.findMany({
        where: { storeId, ...(includeHidden ? {} : { active: true }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: WITH_USAGE,
      });

      return colors.map(toColorDto);
    });
  }

  create(storeId: string, dto: CreateColorDto): Promise<ColorDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const slug = await availableSlug(tx, storeId, dto.name);

      const color = await tx.color.create({
        data: {
          storeId,
          slug,
          name: dto.name,
          hex: dto.hex.toUpperCase(),
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active ?? true,
        },
        include: WITH_USAGE,
      });

      return toColorDto(color);
    });
  }

  update(storeId: string, colorId: string, dto: UpdateColorDto): Promise<ColorDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const color = await tx.color.update({
          where: { id: colorId, storeId },
          data: {
            // `?? undefined`: la validación deja pasar null en un campo
            // opcional, y en estas columnas null no significa "vaciar" sino
            // "no lo toques". Mandarlo tal cual sería un 500 de Prisma.
            name: dto.name ?? undefined,
            hex: dto.hex?.toUpperCase(),
            sortOrder: dto.sortOrder ?? undefined,
            active: dto.active ?? undefined,
          },
          include: WITH_USAGE,
        });

        return toColorDto(color);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Borra el color, o lo oculta si alguna variante lo usa.
   *
   * Se cuenta ANTES en vez de intentar el borrado y reaccionar al error de
   * clave foránea, que es lo que hacía la versión con Supabase. Allá cada
   * llamada era su propia petición; acá todo va en una transacción, y en
   * Postgres un error dentro de una transacción la deja abortada: el `update`
   * que ocultaría el color ya no podría ejecutarse.
   */
  remove(storeId: string, colorId: string): Promise<RemovalResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const color = await tx.color.findFirst({
        where: { id: colorId, storeId },
        include: WITH_USAGE,
      });

      if (!color) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (color._count.variants > 0) {
        await tx.color.update({ where: { id: colorId, storeId }, data: { active: false } });

        return { hidden: true };
      }

      await tx.color.delete({ where: { id: colorId, storeId } });

      return { hidden: false };
    });
  }
}

/** El nombre manda: el slug se deriva de él y se numera si ya existe en la tienda. */
async function availableSlug(tx: TenantClient, storeId: string, name: string): Promise<string> {
  const base = slugify(name) || 'sin-nombre';

  const existing = await tx.color.findMany({
    where: { storeId, slug: { startsWith: base } },
    select: { slug: true },
  });

  return firstAvailable(base, new Set(existing.map((row) => row.slug)));
}

function toColorDto(color: Prisma.ColorGetPayload<{ include: typeof WITH_USAGE }>): ColorDto {
  return {
    id: color.id,
    slug: color.slug,
    name: color.name,
    hex: color.hex,
    sortOrder: color.sortOrder,
    active: color.active,
    usageCount: color._count.variants,
  };
}
