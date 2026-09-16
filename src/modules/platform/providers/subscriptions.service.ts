import { Injectable, NotFoundException } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PlanDto, SubscriptionSummaryDto } from '@shared/dtos/platform/platform.dto';
import { startOfMonthInBogota } from '@shared/utils/bogota-time';
import { PrismaService } from '@db/prisma.service';

const DAY_MS = 86_400_000;

/** Lo que una tienda ve de su propio plan: para el aviso del panel y el botón de cambiar de plan. */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(storeId: string): Promise<SubscriptionSummaryDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true, trialEndsAt: true },
    });

    if (!store) {
      throw new NotFoundException('Esta tienda no existe.');
    }

    return this.prisma.forStore(storeId, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { storeId },
        include: { plan: true },
      });

      if (!subscription) {
        throw new NotFoundException('La tienda no tiene suscripción.');
      }

      const products = await tx.product.count({ where: { storeId } });
      const ordersThisMonth = await tx.order.count({
        where: { storeId, createdAt: { gte: startOfMonthInBogota(new Date()) } },
      });

      return {
        plan: toPlanDto(subscription.plan),
        status: subscription.status,
        storeStatus: store.status,
        currentPeriodEnd: toDateOnly(subscription.currentPeriodEnd),
        trialEndsAt: store.trialEndsAt,
        daysLeft: daysUntil(subscription.currentPeriodEnd),
        usage: { products, ordersThisMonth },
      };
    });
  }
}

export function toPlanDto(plan: Plan): PlanDto {
  return {
    code: plan.code,
    name: plan.name,
    priceCop: plan.priceCop,
    maxProducts: plan.maxProducts,
    maxOrdersPerMonth: plan.maxOrdersPerMonth,
    maxImagesPerProduct: plan.maxImagesPerProduct,
    customDomain: plan.customDomain,
    active: plan.active,
  };
}

/** Las columnas `@db.Date` llegan como medianoche UTC; se devuelven como `YYYY-MM-DD`. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Días enteros hasta el final del día indicado. Negativo cuando ya pasó. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const endOfDay = date.getTime() + DAY_MS;

  return Math.floor((endOfDay - now.getTime()) / DAY_MS);
}
