import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, Prisma, Store } from '@prisma/client';
import {
  ChangePlanDto,
  PaymentDto,
  PlanDto,
  PlatformStoreDetailDto,
  PlatformStoreDto,
  PlatformStoreListQueryDto,
  ReconcileResultDto,
  RecordPaymentDto,
  UpdateStoreStatusDto,
} from '@shared/dtos/platform/platform.dto';
import { PrismaService } from '@db/prisma.service';

import { toDateOnly, toPlanDto } from './subscriptions.service';

const STORE_INCLUDE = {
  members: {
    include: { user: { select: { id: true, email: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { products: true, orders: true } },
} satisfies Prisma.StoreInclude;

type StoreWithMembers = Prisma.StoreGetPayload<{ include: typeof STORE_INCLUDE }>;

interface SubscriptionRow {
  planCode: string;
  status: PlatformStoreDto['subscriptionStatus'];
  currentPeriodEnd: Date;
  notes: string | null;
}

/** Hasta cuántas tiendas devuelve el listado. Una plataforma con más ya necesita paginar. */
const LIST_LIMIT = 200;

const STORE_NOT_FOUND = 'Esa tienda no existe.';

/**
 * Administración de la plataforma: tiendas, pagos y estado.
 *
 * `stores`, `users`, `store_members` y `plans` no están bajo RLS, pero
 * `subscriptions` y `payments` sí: cada lectura de esas tablas pasa por
 * `forStore` con la tienda en cuestión. Es una consulta más por tienda en el
 * listado y se acepta a propósito: la alternativa —una política que deje ver
 * todas las tiendas a un contexto "plataforma"— es exactamente el agujero que
 * RLS existe para no tener.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({ orderBy: { priceCop: 'asc' } });

    return plans.map(toPlanDto);
  }

  async listStores(query: PlatformStoreListQueryDto): Promise<PlatformStoreDto[]> {
    const search = query.q?.trim();

    const stores = await this.prisma.store.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { slug: { contains: search, mode: Prisma.QueryMode.insensitive } },
                {
                  members: {
                    some: {
                      user: { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: STORE_INCLUDE,
    });

    const rows: PlatformStoreDto[] = [];

    for (const store of stores) {
      const subscription = await this.subscriptionOf(store.id);

      if (query.overdue && !isOverdue(store, subscription, new Date())) {
        continue;
      }

      rows.push(toStoreDto(store, subscription));
    }

    return rows;
  }

  async getStore(storeId: string): Promise<PlatformStoreDetailDto> {
    const store = await this.requireStore(storeId);

    return this.prisma.forStore(storeId, async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { storeId } });
      const payments = await tx.payment.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        include: { recordedBy: { select: { email: true } } },
      });

      return {
        ...toStoreDto(store, subscription),
        subscriptionNotes: subscription?.notes ?? null,
        payments: payments.map(toPaymentDto),
      };
    });
  }

  /**
   * Activa o suspende a mano.
   *
   * Suspender apaga la tienda pública y deja el panel en lectura (lo aplican
   * `PublicStoreResolver` y `StoreRolesGuard`). Reactivar no toca la
   * suscripción: si estaba vencida, sigue vencida y el aviso del panel lo dice.
   */
  async setStatus(storeId: string, dto: UpdateStoreStatusDto): Promise<PlatformStoreDetailDto> {
    await this.requireStore(storeId);

    await this.prisma.store.update({ where: { id: storeId }, data: { status: dto.status } });

    return this.getStore(storeId);
  }

  async changePlan(storeId: string, dto: ChangePlanDto): Promise<PlatformStoreDetailDto> {
    await this.requireStore(storeId);

    const plan = await this.prisma.plan.findUnique({ where: { code: dto.planCode } });

    if (!plan || !plan.active) {
      throw new BadRequestException('Ese plan no existe o ya no se ofrece.');
    }

    await this.prisma.forStore(storeId, async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { storeId },
        data: { planCode: plan.code, notes: dto.notes === undefined ? undefined : dto.notes },
      });

      if (updated.count === 0) {
        throw new NotFoundException('La tienda no tiene suscripción.');
      }
    });

    return this.getStore(storeId);
  }

  /**
   * Registra un pago a mano y extiende el período.
   *
   * El pago es un asiento: no se edita ni se borra. El período nuevo empieza
   * donde termina el vigente, nunca antes: pagar dos meses seguidos suma, no
   * pisa. La tienda en prueba o vencida vuelve a ACTIVE; una suspendida a mano
   * sigue suspendida, porque suspender fue una decisión y reactivar es otra.
   */
  async recordPayment(
    storeId: string,
    dto: RecordPaymentDto,
    recordedById: string,
  ): Promise<PlatformStoreDetailDto> {
    const store = await this.requireStore(storeId);
    const periodStart = parseDateOnly(dto.periodStart);
    const periodEnd = parseDateOnly(dto.periodEnd);

    if (periodEnd < periodStart) {
      throw new BadRequestException('El período termina antes de empezar.');
    }

    await this.prisma.forStore(storeId, async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { storeId } });

      if (!subscription) {
        throw new NotFoundException('La tienda no tiene suscripción.');
      }

      await tx.payment.create({
        data: {
          storeId,
          amountCop: dto.amountCop,
          periodStart,
          periodEnd,
          method: dto.method,
          reference: dto.reference ?? null,
          recordedById,
        },
      });

      await tx.subscription.update({
        where: { storeId },
        data: {
          status: 'ACTIVE',
          currentPeriodEnd:
            periodEnd > subscription.currentPeriodEnd ? periodEnd : subscription.currentPeriodEnd,
        },
      });
    });

    if (store.status === 'TRIAL' || store.status === 'PAST_DUE') {
      await this.prisma.store.update({
        where: { id: storeId },
        // Pasó a pago: la prueba deja de existir.
        data: { status: 'ACTIVE', trialEndsAt: null },
      });
    }

    return this.getStore(storeId);
  }

  /**
   * Marca como vencidas las tiendas cuyo período terminó.
   *
   * No hay reloj dentro de la API: esto lo dispara un cron externo una vez al
   * día (o un administrador a mano). PAST_DUE solo avisa; suspender sigue
   * siendo una decisión de una persona.
   */
  async reconcile(now: Date = new Date(), storeId?: string): Promise<ReconcileResultDto> {
    const candidates = await this.prisma.store.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, ...(storeId ? { id: storeId } : {}) },
      select: { id: true, status: true, trialEndsAt: true },
    });

    let markedPastDue = 0;

    for (const store of candidates) {
      if (!isOverdue(store, await this.subscriptionOf(store.id), now)) {
        continue;
      }

      await this.prisma.store.update({ where: { id: store.id }, data: { status: 'PAST_DUE' } });
      await this.prisma.forStore(store.id, (tx) =>
        tx.subscription.updateMany({ where: { storeId: store.id }, data: { status: 'PAST_DUE' } }),
      );

      markedPastDue += 1;
    }

    return { markedPastDue };
  }

  private async requireStore(storeId: string): Promise<StoreWithMembers> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: STORE_INCLUDE,
    });

    if (!store) {
      throw new NotFoundException(STORE_NOT_FOUND);
    }

    return store;
  }

  private subscriptionOf(storeId: string): Promise<SubscriptionRow | null> {
    return this.prisma.forStore(storeId, (tx) =>
      tx.subscription.findUnique({
        where: { storeId },
        select: { planCode: true, status: true, currentPeriodEnd: true, notes: true },
      }),
    );
  }
}

function toStoreDto(
  store: StoreWithMembers,
  subscription: SubscriptionRow | null,
): PlatformStoreDto {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    customDomain: store.customDomain,
    status: store.status,
    trialEndsAt: store.trialEndsAt,
    createdAt: store.createdAt,
    planCode: subscription?.planCode ?? null,
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription ? toDateOnly(subscription.currentPeriodEnd) : null,
    members: store.members.map((member) => ({
      userId: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
      role: member.role,
    })),
    productCount: store._count.products,
    orderCount: store._count.orders,
  };
}

function toPaymentDto(payment: Payment & { recordedBy: { email: string } | null }): PaymentDto {
  return {
    id: payment.id,
    amountCop: payment.amountCop,
    periodStart: toDateOnly(payment.periodStart),
    periodEnd: toDateOnly(payment.periodEnd),
    method: payment.method,
    reference: payment.reference,
    recordedBy: payment.recordedBy?.email ?? null,
    createdAt: payment.createdAt,
  };
}

/** `YYYY-MM-DD` a la medianoche UTC de ese día: así guarda Postgres una columna `date`. */
function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Vencida: ya marcada, prueba terminada, o período pago que pasó.
 *
 * Un solo criterio para `reconcile` y para el filtro del listado: si cada uno
 * decidiera por su lado, el listado mostraría una tienda como al día mientras
 * el cron la marca vencida.
 */
function isOverdue(
  store: Pick<Store, 'status' | 'trialEndsAt'>,
  subscription: Pick<SubscriptionRow, 'currentPeriodEnd'> | null,
  now: Date,
): boolean {
  if (store.status === 'PAST_DUE') {
    return true;
  }

  const trialOver = store.status === 'TRIAL' && !!store.trialEndsAt && store.trialEndsAt < now;
  const periodOver = !!subscription && subscription.currentPeriodEnd < startOfDay(now);

  return trialOver || periodOver;
}
