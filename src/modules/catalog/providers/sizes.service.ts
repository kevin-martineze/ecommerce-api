import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RemovalResultDto } from '@shared/dtos/catalog/catalog-common.dto';
import { CreateSizeDto, SizeDto, UpdateSizeDto } from '@shared/dtos/catalog/size.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { PrismaService } from '@db/prisma.service';

const WITH_USAGE = { _count: { select: { variants: true } } } satisfies Prisma.SizeInclude;

const NOT_FOUND = 'Esa talla no existe.';
const DUPLICATED = 'Ya existe esa talla.';

@Injectable()
export class SizesService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string, includeHidden: boolean): Promise<SizeDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const sizes = await tx.size.findMany({
        where: { storeId, ...(includeHidden ? {} : { active: true }) },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        include: WITH_USAGE,
      });

      return sizes.map(toSizeDto);
    });
  }

  create(storeId: string, dto: CreateSizeDto): Promise<SizeDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const size = await tx.size.create({
          data: {
            storeId,
            label: dto.label,
            sortOrder: dto.sortOrder ?? 0,
            active: dto.active ?? true,
          },
          include: WITH_USAGE,
        });

        return toSizeDto(size);
      }),
      { conflict: DUPLICATED },
    );
  }

  update(storeId: string, sizeId: string, dto: UpdateSizeDto): Promise<SizeDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const size = await tx.size.update({
          where: { id: sizeId, storeId },
          // `?? undefined`: null en un campo opcional es "no lo toques". Ver ColorsService.update.
          data: {
            label: dto.label ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
            active: dto.active ?? undefined,
          },
          include: WITH_USAGE,
        });

        return toSizeDto(size);
      }),
      { notFound: NOT_FOUND, conflict: DUPLICATED },
    );
  }

  /** Borra la talla, o la oculta si alguna variante la usa. Ver ColorsService.remove. */
  remove(storeId: string, sizeId: string): Promise<RemovalResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const size = await tx.size.findFirst({
        where: { id: sizeId, storeId },
        include: WITH_USAGE,
      });

      if (!size) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (size._count.variants > 0) {
        await tx.size.update({ where: { id: sizeId, storeId }, data: { active: false } });

        return { hidden: true };
      }

      await tx.size.delete({ where: { id: sizeId, storeId } });

      return { hidden: false };
    });
  }
}

function toSizeDto(size: Prisma.SizeGetPayload<{ include: typeof WITH_USAGE }>): SizeDto {
  return {
    id: size.id,
    label: size.label,
    sortOrder: size.sortOrder,
    active: size.active,
    usageCount: size._count.variants,
  };
}
