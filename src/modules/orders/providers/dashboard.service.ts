import { Injectable } from '@nestjs/common';
import { LOW_STOCK_THRESHOLD } from '@shared/commerce/stock';
import { DashboardDto } from '@shared/dtos/orders/order-admin.dto';
import { startOfMonthInBogota } from '@shared/utils/bogota-time';
import { PrismaService } from '@db/prisma.service';

/** Un pendiente con más de esto retiene stock sin avanzar, y el resumen lo destaca. */
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

/** Cuántas variantes con poco stock caben en el resumen. */
const LOW_STOCK_LIMIT = 12;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  get(storeId: string): Promise<DashboardDto> {
    const now = new Date();

    return this.prisma.forStore(storeId, async (tx) => {
      const pendingOrders = await tx.order.count({ where: { storeId, status: 'PENDING' } });

      const stalePendingOrders = await tx.order.count({
        where: {
          storeId,
          status: 'PENDING',
          createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) },
        },
      });

      const month = await tx.order.aggregate({
        where: {
          storeId,
          status: { not: 'CANCELLED' },
          createdAt: { gte: startOfMonthInBogota(now) },
        },
        _sum: { total: true },
        _count: { _all: true },
      });

      const lowStock = await tx.variant.findMany({
        where: {
          storeId,
          active: true,
          stock: { lte: LOW_STOCK_THRESHOLD },
          product: { status: 'ACTIVE' },
        },
        orderBy: [{ stock: 'asc' }, { id: 'asc' }],
        take: LOW_STOCK_LIMIT,
        include: {
          product: { select: { name: true } },
          color: { select: { name: true } },
          size: { select: { label: true } },
        },
      });

      const pendingRestock = await tx.restockRequest.count({
        where: { storeId, notifiedAt: null },
      });

      return {
        pendingOrders,
        stalePendingOrders,
        monthRevenue: month._sum.total ?? 0,
        monthOrders: month._count._all,
        lowStock: lowStock.map((variant) => ({
          variantId: variant.id,
          stock: variant.stock,
          productName: variant.product.name,
          colorName: variant.color.name,
          sizeLabel: variant.size.label,
        })),
        pendingRestock,
      };
    });
  }
}
