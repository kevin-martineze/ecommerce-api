import { Module } from '@nestjs/common';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { OrderPaymentsController } from './controllers/order-payments.controller';
import { StoreEventsController } from './controllers/store-events.controller';
import { StorePaymentsController } from './controllers/store-payments.controller';
import { OrderPaymentsService } from './providers/order-payments.service';
import { StorePaymentsService } from './providers/store-payments.service';

/**
 * Los pagos de las tiendas: su cuenta de comercio, el cobro de un pedido y lo
 * que la pasarela responde sobre él.
 *
 * Aparte de `platform`, donde vive el cobro de la mensualidad: son plata de
 * distinto dueño. La de las ventas es de la tienda y sale por su cuenta; la de
 * la mensualidad es de Globerce.
 */
@Module({
  controllers: [StorePaymentsController, OrderPaymentsController, StoreEventsController],
  providers: [PublicStoreResolver, StorePaymentsService, OrderPaymentsService],
  exports: [StorePaymentsService],
})
export class StorePaymentsModule {}
