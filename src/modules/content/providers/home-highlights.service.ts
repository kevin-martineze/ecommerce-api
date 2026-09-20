import { Injectable } from '@nestjs/common';
import { HomeHighlight } from '@prisma/client';
import {
  CreateHomeHighlightDto,
  HomeHighlightAdminDto,
  UpdateHomeHighlightDto,
} from '@shared/dtos/content/home-highlight.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { PrismaService } from '@db/prisma.service';

const NOT_FOUND = 'Ese bloque no existe.';

/** Bloques de texto de la portada, bajo el hero. */
@Injectable()
export class HomeHighlightsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todos, también los ocultos: el panel los muestra para poder volver a activarlos. */
  list(storeId: string): Promise<HomeHighlightAdminDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const highlights = await tx.homeHighlight.findMany({
        where: { storeId },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      });

      return highlights.map(toDto);
    });
  }

  create(storeId: string, dto: CreateHomeHighlightDto): Promise<HomeHighlightAdminDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const highlight = await tx.homeHighlight.create({
        data: {
          storeId,
          eyebrow: dto.eyebrow,
          title: dto.title,
          body: dto.body,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active ?? true,
        },
      });

      return toDto(highlight);
    });
  }

  update(
    storeId: string,
    highlightId: string,
    dto: UpdateHomeHighlightDto,
  ): Promise<HomeHighlightAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const highlight = await tx.homeHighlight.update({
          where: { id: highlightId, storeId },
          // Todas las columnas son obligatorias: null es "no lo toques".
          data: {
            eyebrow: dto.eyebrow ?? undefined,
            title: dto.title ?? undefined,
            body: dto.body ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
            active: dto.active ?? undefined,
          },
        });

        return toDto(highlight);
      }),
      { notFound: NOT_FOUND },
    );
  }

  remove(storeId: string, highlightId: string): Promise<void> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        await tx.homeHighlight.delete({ where: { id: highlightId, storeId } });
      }),
      { notFound: NOT_FOUND },
    );
  }
}

function toDto(highlight: HomeHighlight): HomeHighlightAdminDto {
  return {
    id: highlight.id,
    eyebrow: highlight.eyebrow,
    title: highlight.title,
    body: highlight.body,
    sortOrder: highlight.sortOrder,
    active: highlight.active,
  };
}
