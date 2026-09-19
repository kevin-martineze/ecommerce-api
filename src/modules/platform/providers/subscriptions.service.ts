import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, Plan, StoreStatus } from '@prisma/client';
import { Env } from '@shared/config/env';
import { PaymentEvent, PaymentGateway } from '@shared/payments/gateway';
import {
  PlanDto,
  SubscriptionCheckoutDto,
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

/** Lo que antecede a la referencia del cobro de un plan. */
const SUB_PREFIX = 'sub';

/**
 * El plan visto desde la tienda: qué tiene, cuánto lleva usado y cómo se paga.
 *
 * Pagar es ir a la pasarela y volver; lo que decide que el plan quedó al día
 * NO es que la dueña vuelva a la página, sino el evento firmado que manda la
 * pasarela. Por eso `aplicarPago` es el único camino que extiende el período,
 * y da igual si lo llama el evento de Wompi o la pantalla simulada.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway | null,
  ) {}

  /** Si la tienda puede pagar sola, sin escribirle a nadie. */
  private get selfService(): boolean {
    return this.gateway !== null;
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
  /**
   * Empieza el cobro del plan: devuelve a dónde mandar a la dueña a pagar.
   *
   * Lo que se cobra NO viene de la petición: el monto sale del plan que hay en
   * la base. Si viniera de afuera, cualquiera pediría pagar cien pesos por el
   * Pro.
   *
   * La referencia lleva la tienda y el plan porque el evento vuelve sin
   * sesión: es lo único que dirá a qué corresponde ese pago.
   */
  async checkout(storeId: string, planCode: string): Promise<SubscriptionCheckoutDto> {
    const gateway = this.gateway;

    if (!gateway) {
      throw new BadRequestException(
        'Los pagos en línea todavía no están disponibles. Escríbenos y activamos tu plan.',
      );
    }

    const plan = await this.plan(planCode);
    const store = await this.storeForPayment(storeId);
    const reference = `${SUB_PREFIX}-${storeId}-${plan.code}-${randomUUID().slice(0, 8)}`;

    const session = gateway.checkout({
      reference,
      amountCop: plan.priceCop,
      description: `Globerce · plan ${plan.name} · ${store.name}`,
      redirectUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/admin/plan`,
    });

    this.logger.log(`Cobro del plan ${plan.code} iniciado para la tienda ${storeId}`);

    return { url: session.url, reference: session.reference, amountCop: plan.priceCop };
  }

  /**
   * Aplica un pago que la pasarela dio por bueno.
   *
   * Es el ÚNICO camino que extiende el período. Lo llama el evento firmado de
   * la pasarela; que la dueña vuelva a la página no prueba nada —puede volver
   * sin haber pagado, o no volver nunca—.
   *
   * Repetir el mismo pago no suma dos meses: la referencia de la transacción
   * es única en `payments`, y si ya estaba, este pago ya se aplicó.
   */
  async applyPayment(event: PaymentEvent): Promise<void> {
    if (event.status !== 'approved') return;

    const destino = parseReference(event.reference);

    if (!destino) {
      this.logger.warn(`Pago ${event.transactionId} con una referencia que no reconozco.`);

      return;
    }

    const plan = await this.plan(destino.planCode);

    // El monto tiene que ser el del plan: un pago por menos no compra un mes.
    if (event.amountCop < plan.priceCop) {
      this.logger.warn(
        `Pago ${event.transactionId} por ${event.amountCop} cuando el plan ${plan.code} vale ${plan.priceCop}.`,
      );

      return;
    }

    const store = await this.storeForPayment(destino.storeId);

    const aplicado = await this.prisma.forStore(destino.storeId, async (tx) => {
      const yaEstaba = await tx.payment.findFirst({
        where: { storeId: destino.storeId, reference: event.transactionId },
        select: { id: true },
      });

      if (yaEstaba) return false;

      const subscription = await tx.subscription.findUnique({
        where: { storeId: destino.storeId },
      });

      if (!subscription) {
        throw new NotFoundException('La tienda no tiene suscripción.');
      }

      const today = startOfDay(new Date());
      const desde =
        subscription.currentPeriodEnd > today ? nextDay(subscription.currentPeriodEnd) : today;
      const hasta = addDays(desde, PERIOD_DAYS - 1);

      await tx.payment.create({
        data: {
          storeId: destino.storeId,
          amountCop: event.amountCop,
          periodStart: desde,
          periodEnd: hasta,
          method: event.method,
          reference: event.transactionId,
        },
      });

      await tx.subscription.update({
        where: { storeId: destino.storeId },
        data: { planCode: plan.code, status: 'ACTIVE', currentPeriodEnd: hasta },
      });

      return true;
    });

    if (!aplicado) {
      this.logger.log(`Pago ${event.transactionId} repetido: no se aplica dos veces.`);

      return;
    }

    if (store.status !== 'SUSPENDED') {
      await this.prisma.store.update({
        where: { id: destino.storeId },
        // Pasó a pago: la prueba deja de existir.
        data: { status: 'ACTIVE', trialEndsAt: null },
      });
    }

    this.logger.log(`Plan ${plan.code} al día para la tienda ${destino.storeId} (${event.method})`);
  }

  private async plan(code: string): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { code } });

    if (!plan || !plan.active) {
      throw new BadRequestException('Ese plan no existe o ya no se ofrece.');
    }

    return plan;
  }

  /** La tienda, y que esté en condiciones de pagar. */
  private async storeForPayment(storeId: string): Promise<{ name: string; status: StoreStatus }> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, status: true },
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

    return store;
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

/** De la referencia salen la tienda y el plan: el evento vuelve sin sesión. */
function parseReference(reference: string): { storeId: string; planCode: string } | null {
  const partes = reference.split('-');

  // `sub-<uuid con 5 partes>-<plan>-<azar>`
  if (partes.length !== 8 || partes[0] !== SUB_PREFIX) return null;

  return { storeId: partes.slice(1, 6).join('-'), planCode: partes[6] ?? '' };
}
