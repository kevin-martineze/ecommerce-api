import { Inject, Injectable } from '@nestjs/common';
import { PaymentGateway } from '@shared/payments/gateway';

import { OrderPaymentsService } from './order-payments.service';
import { StorePaymentsService } from './store-payments.service';

/**
 * Lo que hace la API con un aviso de la pasarela sobre los pedidos de una
 * tienda, llegue por donde llegue.
 *
 * Llega por la URL de la tienda (`/payments/events/:storeId`), o por la de la
 * plataforma cuando la tienda cobra con la misma cuenta de Wompi que Globerce:
 * Wompi permite una sola URL de eventos por cuenta. En los dos casos la firma
 * se comprueba con el secreto de ESA tienda, así que un aviso de otra cuenta
 * no marca nada aunque nombre la tienda.
 */
@Injectable()
export class StoreEventsService {
  constructor(
    private readonly accounts: StorePaymentsService,
    private readonly orders: OrderPaymentsService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway | null,
  ) {}

  /** `false` si la firma no es de la cuenta de esta tienda: no se aplicó nada. */
  async receive(storeId: string, body: unknown): Promise<boolean> {
    if (!this.gateway) return false;

    const credentials = await this.accounts.credentials(storeId);
    const event = this.gateway.parseEvent(body, credentials ?? undefined);

    if (!event) return false;

    // La firma cuadró: Wompi está hablando con esta tienda. Lo guarda el panel para mostrarlo.
    await this.accounts.markEventReceived(storeId);
    await this.orders.applyPayment(storeId, event);

    return true;
  }
}
