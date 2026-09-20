import { Module } from '@nestjs/common';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { CheckoutController } from './controllers/checkout.controller';
import { OrdersController } from './controllers/orders.controller';
import { CheckoutService } from './providers/checkout.service';
import { DashboardService } from './providers/dashboard.service';
import { OrdersService } from './providers/orders.service';

/**
 * Pedidos: el carrito y el checkout de la tienda pública, y la gestión en el
 * panel. Van en un módulo porque comparten la regla más delicada —qué le pasa
 * al stock— y separarla en dos sería invitar a que diverja.
 */
@Module({
  controllers: [CheckoutController, OrdersController],
  providers: [PublicStoreResolver, CheckoutService, OrdersService, DashboardService],
})
export class OrdersModule {}
