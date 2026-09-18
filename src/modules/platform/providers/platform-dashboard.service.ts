import { Injectable } from '@nestjs/common';
import { Payment, Prisma, StoreStatus } from '@prisma/client';
import {
  MonthPaymentsDto,
  OverdueStoreDto,
  PlatformDashboardDto,
  PlatformPaymentDto,
  TrialEndingDto,
} from '@shared/dtos/platform/platform.dto';
import { bogotaMonthKey, bogotaMonthRange } from '@shared/utils/bogota-time';
import { PrismaService } from '@db/prisma.service';

import { daysUntil, toDateOnly } from './subscriptions.service';

const DAY_MS = 86_400_000;

/** Con cuántos días de anticipación aparece una prueba en "por vencer". */
const TRIAL_WARNING_DAYS = 7;

const RECENT_PAYMENTS = 10;

const STORE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  trialEndsAt: true,
  members: {
    where: { role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { user: { select: { email: true } } },
  },
} satisfies Prisma.StoreSelect;

type StoreRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

/** Lo que de una tienda vive bajo RLS y el resumen necesita. */
interface TenantBilling {
  subscription: { status: string; planPriceCop: number; currentPeriodEnd: Date } | null;
  payments: Payment[];
}

/**
 * Los números del negocio para quien vende Globerce: cuánto entra, quién paga
 * y quién está por dejar de pagar.
 *
 * `subscriptions` y `payments` están bajo RLS, así que se leen tienda por
 * tienda con su contexto (ver la nota en `PlatformService`). Es una
 * transacción por tienda; con cientos de tiendas convendrá guardar estos
 * totales precalculados, no relajar el aislamiento.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(now: Date = new Date()): Promise<PlatformDashboardDto> {
    const stores = await this.prisma.store.findMany({ select: STORE_SELECT });
    const thisMonth = bogotaMonthRange(bogotaMonthKey(now));
    const lastMonth = bogotaMonthRange(
      bogotaMonthKey(new Date(thisMonth.start.getTime() - DAY_MS)),
    );

    const counts = { total: stores.length, trial: 0, active: 0, pastDue: 0, suspended: 0 };
    let payingStores = 0;
    let mrr = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    const trialsEnding: TrialEndingDto[] = [];
    const overdue: OverdueStoreDto[] = [];
    const payments: PlatformPaymentDto[] = [];

    for (const store of stores) {
      counts[countKey(store.status)] += 1;

      const billing = await this.billingOf(store.id);

      if (billing.subscription?.status === 'ACTIVE') {
        payingStores += 1;

        if (store.status !== 'SUSPENDED') {
          mrr += billing.subscription.planPriceCop;
        }
      }

      for (const payment of billing.payments) {
        if (payment.createdAt >= thisMonth.start && payment.createdAt < thisMonth.end) {
          revenueThisMonth += payment.amountCop;
        } else if (payment.createdAt >= lastMonth.start && payment.createdAt < lastMonth.end) {
          revenueLastMonth += payment.amountCop;
        }

        payments.push(toPlatformPayment(store, payment));
      }

      if (store.status === 'TRIAL' && store.trialEndsAt) {
        const daysLeft = Math.ceil((store.trialEndsAt.getTime() - now.getTime()) / DAY_MS);

        if (daysLeft <= TRIAL_WARNING_DAYS) {
          trialsEnding.push({ ...toRef(store), trialEndsAt: store.trialEndsAt, daysLeft });
        }
      }

      if (store.status === 'PAST_DUE') {
        const end = billing.subscription?.currentPeriodEnd ?? null;

        overdue.push({
          ...toRef(store),
          currentPeriodEnd: end ? toDateOnly(end) : null,
          daysOverdue: end ? Math.max(0, -daysUntil(end, now)) : 0,
        });
      }
    }

    trialsEnding.sort((a, b) => a.daysLeft - b.daysLeft);
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      stores: counts,
      payingStores,
      mrr,
      revenueThisMonth,
      revenueLastMonth,
      trialsEnding,
      overdue,
      recentPayments: payments.slice(0, RECENT_PAYMENTS),
    };
  }

  async paymentsOfMonth(month: string): Promise<MonthPaymentsDto> {
    const range = bogotaMonthRange(month);
    const stores = await this.prisma.store.findMany({ select: STORE_SELECT });
    const payments: PlatformPaymentDto[] = [];

    for (const store of stores) {
      const rows = await this.prisma.forStore(store.id, (tx) =>
        tx.payment.findMany({
          where: { storeId: store.id, createdAt: { gte: range.start, lt: range.end } },
          include: { recordedBy: { select: { email: true } } },
        }),
      );

      for (const row of rows) {
        payments.push(toPlatformPayment(store, row, row.recordedBy?.email ?? null));
      }
    }

    payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      month,
      total: payments.reduce((sum, payment) => sum + payment.amountCop, 0),
      payments,
    };
  }

  private billingOf(storeId: string): Promise<TenantBilling> {
    return this.prisma.forStore(storeId, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { storeId },
        select: { status: true, currentPeriodEnd: true, plan: { select: { priceCop: true } } },
      });

      return {
        subscription: subscription
          ? {
              status: subscription.status,
              planPriceCop: subscription.plan.priceCop,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }
          : null,
        payments: await tx.payment.findMany({ where: { storeId } }),
      };
    });
  }
}

function countKey(status: StoreStatus): 'trial' | 'active' | 'pastDue' | 'suspended' {
  switch (status) {
    case 'TRIAL':
      return 'trial';
    case 'ACTIVE':
      return 'active';
    case 'PAST_DUE':
      return 'pastDue';
    case 'SUSPENDED':
      return 'suspended';
  }
}

function toRef(store: StoreRow) {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    ownerEmail: store.members[0]?.user.email ?? null,
  };
}

function toPlatformPayment(
  store: StoreRow,
  payment: Payment,
  recordedBy: string | null = null,
): PlatformPaymentDto {
  return {
    id: payment.id,
    storeId: store.id,
    storeName: store.name,
    storeSlug: store.slug,
    amountCop: payment.amountCop,
    periodStart: toDateOnly(payment.periodStart),
    periodEnd: toDateOnly(payment.periodEnd),
    method: payment.method,
    reference: payment.reference,
    recordedBy,
    createdAt: payment.createdAt,
  };
}
