import type { CustomDomainStatus, StoreStatus } from '@prisma/client';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';
import { OrderCheckoutDto, PaymentLinkDto } from '@shared/dtos/payments/payments.dto';
import { PaymentEvent, PaymentGateway } from '@shared/payments/gateway';
import { safeReturnUrl } from '@shared/payments/return-url';
import { PrismaService } from '@db/prisma.service';
import { planAllowsCustomDomain } from '@shared/tenancy/custom-domain-plan';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { StorePaymentsService } from './store-payments.service';

/** Lo que antecede a la referencia del cobro de un pedido. */
const ORDER_PREFIX = 'ord';

/**
 * Cobrarle a la clienta su pedido, con la cuenta de la tienda.
 *
 * El monto sale del pedido que está en la base, nunca de la petición: si
 * viniera de afuera, cualquiera pagaría mil pesos por un pedido de doscientos
 * mil. Y lo que marca el pedido como pagado no es que la clienta vuelva de la
 * pasarela, sino el evento firmado que esa pasarela le manda a la API.
 */
@Injectable()
export class OrderPaymentsService {
  private readonly logger = new Logger(OrderPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: PublicStoreResolver,
    private readonly accounts: StorePaymentsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway | null,
  ) {}

  async checkout(
    storeSlug: string,
    number: number,
    dto: OrderCheckoutDto,
  ): Promise<PaymentLinkDto> {
    const gateway = this.gateway;

    if (!gateway) {
      throw new BadRequestException('Esta tienda no recibe pagos en línea.');
    }

    const store = await this.stores.resolve(storeSlug);
    const credentials = await this.accounts.credentials(store.id);

    // Sin cuenta conectada no se cobra, ni siquiera con la pasarela simulada:
    // la vitrina anuncia «pago en línea» mirando esa misma cuenta, y las dos
    // cosas tienen que decir lo mismo.
    if (!credentials) {
      throw new BadRequestException('Esta tienda no recibe pagos en línea.');
    }

    const order = await this.prisma.forStore(store.id, (tx) =>
      tx.order.findFirst({
        where: { storeId: store.id, number, publicToken: dto.token },
        select: { id: true, total: true, paymentStatus: true, status: true, customerName: true },
      }),
    );

    if (!order) {
      throw new NotFoundException('Ese pedido no existe.');
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Ese pedido ya está pago.');
    }

    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Ese pedido está cancelado.');
    }

    const redirectUrl = await this.returnUrl(store, dto.redirectUrl);

    const session = gateway.checkout(
      {
        reference: `${ORDER_PREFIX}-${order.id}`,
        amountCop: order.total,
        description: `${store.name} · pedido #${number}`,
        redirectUrl,
      },
      credentials,
    );

    await this.prisma.forStore(store.id, (tx) =>
      // `updateMany` y no `update`: el filtro nombra la tienda en la misma
      // línea de la consulta (ver tenant-scope.arch-spec).
      tx.order.updateMany({
        where: { id: order.id, storeId: store.id },
        data: { paymentStatus: 'PENDING' },
      }),
    );

    return {
      url: session.url,
      reference: session.reference,
      amountCop: order.total,
      widget: session.widget,
    };
  }

  /**
   * Aplica lo que dijo la pasarela sobre un pedido.
   *
   * Idempotente por la referencia de la transacción, que es única en `orders`:
   * las pasarelas reintentan, y un reintento no puede volver a marcar nada.
   *
   * Un pago aprobado NO confirma el pedido: confirmar es una decisión de la
   * tienda —tiene que ver si puede despacharlo—, y pagar no la reemplaza. Lo
   * que cambia es el estado del cobro, que es otra cosa.
   */
  async applyPayment(storeId: string, event: PaymentEvent): Promise<void> {
    const orderId = parseReference(event.reference);

    if (!orderId) return;

    await this.prisma.forStore(storeId, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, storeId },
        select: { id: true, total: true, paymentStatus: true, paymentReference: true },
      });

      if (!order) {
        this.logger.warn(`Pago ${event.transactionId} de un pedido que no es de esta tienda.`);

        return;
      }

      if (order.paymentReference === event.transactionId) return;

      if (event.status !== 'approved') {
        await tx.order.updateMany({
          where: { id: order.id, storeId },
          data: { paymentStatus: event.status === 'pending' ? 'PENDING' : 'FAILED' },
        });

        return;
      }

      // Un pago por menos del total no paga el pedido. Queda anotado como
      // fallido para que la tienda lo vea y decida.
      if (event.amountCop < order.total) {
        this.logger.warn(
          `Pago ${event.transactionId} por ${event.amountCop} sobre un pedido de ${order.total}.`,
        );

        await tx.order.updateMany({
          where: { id: order.id, storeId },
          data: { paymentStatus: 'FAILED' },
        });

        return;
      }

      await tx.order.updateMany({
        where: { id: order.id, storeId },
        data: {
          paymentStatus: 'PAID',
          paymentReference: event.transactionId,
          paidAt: new Date(),
        },
      });

      this.logger.log(`Pedido ${order.id} pagado (${event.method}).`);
    });
  }

  /**
   * La vuelta de la pasarela: nuestra, o el dominio propio de esta tienda si
   * está vivo (ver safeReturnUrl). Lo demás se rechaza.
   */
  private async returnUrl(
    store: {
      id: string;
      slug: string;
      status: StoreStatus;
      customDomain: string | null;
      customDomainStatus: CustomDomainStatus | null;
    },
    url: string,
  ): Promise<string> {
    const allowsCustomDomain = await this.prisma.forStore(store.id, (tx) =>
      planAllowsCustomDomain(tx, store.id),
    );

    const safe = safeReturnUrl(url, {
      frontendHost: new URL(this.config.get('FRONTEND_URL', { infer: true })).hostname,
      store: { ...store, planAllowsCustomDomain: allowsCustomDomain },
    });

    if (!safe) {
      throw new BadRequestException('La dirección de vuelta no es de esta tienda.');
    }

    return safe;
  }
}

/** `ord-<uuid>`: el uuid trae guiones, así que se corta por el primero y ya. */
function parseReference(reference: string): string | null {
  if (!reference.startsWith(`${ORDER_PREFIX}-`)) return null;

  const id = reference.slice(ORDER_PREFIX.length + 1);

  return id.length === 36 ? id : null;
}
