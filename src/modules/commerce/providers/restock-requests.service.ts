import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RestockRequestAdminDto,
  UpdateRestockRequestDto,
} from '@shared/dtos/commerce/commerce.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { PrismaService } from '@db/prisma.service';

/** Mismo techo que el panel actual. */
const LIST_LIMIT = 200;

const WITH_VARIANT = {
  variant: {
    select: {
      id: true,
      stock: true,
      color: { select: { name: true } },
      size: { select: { label: true } },
      product: { select: { name: true, slug: true } },
    },
  },
} satisfies Prisma.RestockRequestInclude;

type RequestWithVariant = Prisma.RestockRequestGetPayload<{ include: typeof WITH_VARIANT }>;

/** "Avísame cuando vuelva": los contactos que dejan las clientas sobre tallas agotadas. */
@Injectable()
export class RestockRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string): Promise<RestockRequestAdminDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const requests = await tx.restockRequest.findMany({
        where: { storeId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        include: WITH_VARIANT,
      });

      return requests.map(toDto);
    });
  }

  update(
    storeId: string,
    requestId: string,
    dto: UpdateRestockRequestDto,
  ): Promise<RestockRequestAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const request = await tx.restockRequest.update({
          where: { id: requestId, storeId },
          data: { notifiedAt: dto.notified ? new Date() : null },
          include: WITH_VARIANT,
        });

        return toDto(request);
      }),
      { notFound: 'Ese aviso no existe.' },
    );
  }
}

function toDto(request: RequestWithVariant): RestockRequestAdminDto {
  return {
    id: request.id,
    contact: request.contact,
    createdAt: request.createdAt,
    notifiedAt: request.notifiedAt,
    variantId: request.variant.id,
    stock: request.variant.stock,
    productName: request.variant.product.name,
    productSlug: request.variant.product.slug,
    colorName: request.variant.color.name,
    sizeLabel: request.variant.size.label,
  };
}
