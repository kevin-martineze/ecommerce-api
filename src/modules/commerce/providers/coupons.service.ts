import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Coupon, CouponType } from '@prisma/client';
import {
  CouponAdminDto,
  CreateCouponDto,
  DeactivateOrDeleteResultDto,
  UpdateCouponDto,
} from '@shared/dtos/commerce/commerce.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { PrismaService } from '@db/prisma.service';

const NOT_FOUND = 'Ese cupón no existe.';
const DUPLICATED = 'Ya existe un cupón con ese código.';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string): Promise<CouponAdminDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const coupons = await tx.coupon.findMany({
        where: { storeId },
        orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
      });

      return coupons.map(toDto);
    });
  }

  create(storeId: string, dto: CreateCouponDto): Promise<CouponAdminDto> {
    const startsAt = toDate(dto.startsAt) ?? null;
    const endsAt = toDate(dto.endsAt) ?? null;

    assertRules(dto.type, dto.value, startsAt, endsAt);

    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const coupon = await tx.coupon.create({
          data: {
            storeId,
            code: dto.code,
            type: dto.type,
            value: dto.value,
            minSubtotal: dto.minSubtotal ?? 0,
            startsAt,
            endsAt,
            maxUses: dto.maxUses ?? null,
            active: dto.active ?? true,
          },
        });

        return toDto(coupon);
      }),
      { conflict: DUPLICATED },
    );
  }

  /** Las reglas se validan sobre cómo QUEDA el cupón, no solo sobre lo que vino. */
  update(storeId: string, couponId: string, dto: UpdateCouponDto): Promise<CouponAdminDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const current = await tx.coupon.findFirst({ where: { id: couponId, storeId } });

        if (!current) {
          throw new NotFoundException(NOT_FOUND);
        }

        const startsAt =
          dto.startsAt === undefined ? current.startsAt : (toDate(dto.startsAt) ?? null);
        const endsAt = dto.endsAt === undefined ? current.endsAt : (toDate(dto.endsAt) ?? null);

        assertRules(dto.type ?? current.type, dto.value ?? current.value, startsAt, endsAt);

        const coupon = await tx.coupon.update({
          where: { id: couponId, storeId },
          data: {
            type: dto.type ?? undefined,
            value: dto.value ?? undefined,
            minSubtotal: dto.minSubtotal ?? undefined,
            startsAt: dto.startsAt === undefined ? undefined : startsAt,
            endsAt: dto.endsAt === undefined ? undefined : endsAt,
            maxUses: dto.maxUses,
            active: dto.active ?? undefined,
          },
        });

        return toDto(coupon);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Borra el cupón, o lo desactiva si ya se usó.
   *
   * Borrarlo dejaría a sus pedidos con `couponId` en null: el código copiado
   * sigue ahí, pero se pierde de qué cupón vino y cuánto rindió.
   */
  remove(storeId: string, couponId: string): Promise<DeactivateOrDeleteResultDto> {
    return this.prisma.forStore<DeactivateOrDeleteResultDto>(storeId, async (tx) => {
      const coupon = await tx.coupon.findFirst({
        where: { id: couponId, storeId },
        select: { uses: true },
      });

      if (!coupon) {
        throw new NotFoundException(NOT_FOUND);
      }

      const usedInOrders = await tx.order.count({ where: { storeId, couponId } });

      if (usedInOrders > 0 || coupon.uses > 0) {
        await tx.coupon.update({ where: { id: couponId, storeId }, data: { active: false } });

        return { result: 'deactivated' };
      }

      await tx.coupon.delete({ where: { id: couponId, storeId } });

      return { result: 'deleted' };
    });
  }
}

function assertRules(
  type: CouponType,
  value: number,
  startsAt: Date | null,
  endsAt: Date | null,
): void {
  if (type === 'PERCENT' && value > 100) {
    throw new BadRequestException('Un porcentaje no puede pasar de 100.');
  }

  // Mismo criterio que el CHECK `coupons_window_ordered`, con un mensaje legible.
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new BadRequestException('La fecha de fin tiene que ser posterior a la de inicio.');
  }
}

/** `undefined` es "no lo toques"; `null` o vacío, "sin fecha". */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === null || value === '' ? null : new Date(value);
}

function toDto(coupon: Coupon): CouponAdminDto {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    minSubtotal: coupon.minSubtotal,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    maxUses: coupon.maxUses,
    uses: coupon.uses,
    active: coupon.active,
    createdAt: coupon.createdAt,
  };
}
