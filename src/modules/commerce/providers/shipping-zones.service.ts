import { Injectable, NotFoundException } from '@nestjs/common';
import { ShippingZone } from '@prisma/client';
import {
  CreateShippingZoneDto,
  DeactivateOrDeleteResultDto,
  ShippingZoneAdminDto,
  UpdateShippingZoneDto,
} from '@shared/dtos/commerce/commerce.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { PrismaService } from '@db/prisma.service';

const NOT_FOUND = 'Esa zona de envío no existe.';

@Injectable()
export class ShippingZonesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todas, también las inactivas: el panel las muestra para poder reactivarlas. */
  list(storeId: string): Promise<ShippingZoneAdminDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const zones = await tx.shippingZone.findMany({
        where: { storeId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return zones.map(toDto);
    });
  }

  create(storeId: string, dto: CreateShippingZoneDto): Promise<ShippingZoneAdminDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const zone = await tx.shippingZone.create({
        data: {
          storeId,
          name: dto.name,
          cost: dto.cost,
          etaDays: dto.etaDays ?? null,
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      return toDto(zone);
    });
  }

  update(
    storeId: string,
    zoneId: string,
    dto: UpdateShippingZoneDto,
  ): Promise<ShippingZoneAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const zone = await tx.shippingZone.update({
          where: { id: zoneId, storeId },
          data: {
            name: dto.name ?? undefined,
            cost: dto.cost ?? undefined,
            // Null sí significa algo acá: ocultar los días estimados.
            etaDays: dto.etaDays,
            active: dto.active ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
          },
        });

        return toDto(zone);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /** Borra la zona, o la desactiva si algún pedido la usó (el pedido guarda su nombre, pero no su enlace). */
  remove(storeId: string, zoneId: string): Promise<DeactivateOrDeleteResultDto> {
    return this.prisma.forStore<DeactivateOrDeleteResultDto>(storeId, async (tx) => {
      const zone = await tx.shippingZone.findFirst({
        where: { id: zoneId, storeId },
        select: { id: true },
      });

      if (!zone) {
        throw new NotFoundException(NOT_FOUND);
      }

      const usedInOrders = await tx.order.count({ where: { storeId, shippingZoneId: zoneId } });

      if (usedInOrders > 0) {
        await tx.shippingZone.update({ where: { id: zoneId, storeId }, data: { active: false } });

        return { result: 'deactivated' };
      }

      await tx.shippingZone.delete({ where: { id: zoneId, storeId } });

      return { result: 'deleted' };
    });
  }
}

function toDto(zone: ShippingZone): ShippingZoneAdminDto {
  return {
    id: zone.id,
    name: zone.name,
    cost: zone.cost,
    etaDays: zone.etaDays,
    active: zone.active,
    sortOrder: zone.sortOrder,
  };
}
