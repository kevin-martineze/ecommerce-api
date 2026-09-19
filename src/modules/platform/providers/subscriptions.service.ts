import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, Plan } from '@prisma/client';
import { Env } from '@shared/config/env';
import {
  PlanDto,
  SubscriptionPaymentDto,
  SubscriptionSummaryDto,
} from '@shared/dtos/platform/platform.dto';
import { startOfMonthInBogota } from '@shared/utils/bogota-time';
import { PrismaService } from '@db/prisma.service';

const DAY_MS = 86_400_000;

/** Lo que cubre un pago: un mes. Con pasarela real lo dirá el cobro. */
const PERIOD_DAYS = 30;

/** Cuántos pagos se le muestran a la tienda. Los demás los tiene la plataforma. */
const PAYMENTS_SHOWN = 12;

/**
 * El plan visto desde la tienda: qué tiene, cuánto lleva usado y cómo se
 * activa.
 *
 * Mientras no haya pasarela, activar es un pago simulado que solo existe con
 * `BILLING_DRIVER=simulated`. Deja el mismo rastro que dejará el cobro de
 * verdad —un pago registrado y el período extendido—, así que cuando llegue la
 * pasarela cambia quién llama a este método, no lo que hace.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get selfService(): boolean {
    return this.config.get('BILLING_DRIVER', { infer: true }) === 'simulated';
  }

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
      const payments = await tx.payment.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        take: PAYMENTS_SHOWN,
      });

      return {
        plan: toPlanDto(subscription.plan),
        status: subscription.status,
        storeStatus: store.status,
        currentPeriodEnd: toDateOnly(subscription.currentPeriodEnd),
        trialEndsAt: store.trialEndsAt,
        daysLeft: daysUntil(subscription.currentPeriodEnd),
        usage: { products, ordersThisMonth },
        selfServiceBilling: this.selfService,
        payments: payments.map(toPaymentDto),
      };
    });
  }

  /**
   * Activa un plan y lo cobra. Hoy el cobro es de mentira.
   *
   * El período nuevo arranca donde termina el vigente, nunca antes: pagar dos
   * meses seguidos suma. Una tienda suspendida no paga: suspender fue una
   * decisión de la plataforma y deshacerla es otra, así que cobrarle sería
   * cobrar por algo que no se le va a devolver.
   */
  async activate(storeId: string, planCode: string): Promise<SubscriptionSummaryDto> {
    if (!this.selfService) {
      throw new BadRequestException(
        'Los pagos en línea todavía no están disponibles. Escríbenos y activamos tu plan.',
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });

    if (!plan || !plan.active) {
      throw new BadRequestException('Ese plan no existe o ya no se ofrece.');
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });

    if (!store) {
      throw new NotFoundException('Esta tienda no existe.');
    }

    // El guard ya lo corta antes; acá igual, porque el cobro no puede depender
    // de que quien llame a este método se acuerde de mirar el estado.
    if (store.status === 'SUSPENDED') {
      throw new ForbiddenException({
        message: 'La tienda está suspendida: escríbenos para reactivarla.',
        error: 'store_suspended',
      });
    }

    await this.prisma.forStore(storeId, async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { storeId } });

      if (!subscription) {
        throw new NotFoundException('La tienda no tiene suscripción.');
      }

      const today = startOfDay(new Date());
      const desde =
        subscription.currentPeriodEnd > today ? nextDay(subscription.currentPeriodEnd) : today;
      const hasta = addDays(desde, PERIOD_DAYS - 1);

      await tx.payment.create({
        data: {
          storeId,
          amountCop: plan.priceCop,
          periodStart: desde,
          periodEnd: hasta,
          method: 'simulado',
        },
      });

      await tx.subscription.update({
        where: { storeId },
        data: { planCode: plan.code, status: 'ACTIVE', currentPeriodEnd: hasta },
      });
    });

    await this.prisma.store.update({
      where: { id: storeId },
      // Pasó a pago: la prueba deja de existir.
      data: { status: 'ACTIVE', trialEndsAt: null },
    });

    this.logger.log(`Plan ${plan.code} activado (pago simulado) para la tienda ${storeId}`);

    return this.summary(storeId);
  }
}

function toPaymentDto(payment: Payment): SubscriptionPaymentDto {
  return {
    id: payment.id,
    amountCop: payment.amountCop,
    periodStart: toDateOnly(payment.periodStart),
    periodEnd: toDateOnly(payment.periodEnd),
    method: payment.method,
    createdAt: payment.createdAt,
  };
}

/** Las columnas `@db.Date` guardan la medianoche UTC del día. */
function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nextDay(date: Date): Date {
  return new Date(date.getTime() + DAY_MS);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
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
    aiRepliesPerMonth: plan.aiRepliesPerMonth,
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
