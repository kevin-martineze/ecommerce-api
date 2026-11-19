import { Module } from '@nestjs/common';

import { PaymentEventsController } from './controllers/payment-events.controller';
import { PlatformController } from './controllers/platform.controller';
import { PlatformUsersController } from './controllers/platform-users.controller';
import { PublicBillingController } from './controllers/public-billing.controller';
import { PublicPlansController } from './controllers/public-plans.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PlatformDashboardService } from './providers/platform-dashboard.service';
import { PlatformService } from './providers/platform.service';
import { PlatformUsersService } from './providers/platform-users.service';
import { StoreDeletionService } from './providers/store-deletion.service';
import { SubscriptionsService } from './providers/subscriptions.service';

/**
 * Plataforma: la superficie `/platform/*` de quien vende el software (tiendas,
 * pagos y cuentas), lo que
 * cada tienda ve de su propia suscripción, y los planes que el sitio
 * comercial muestra sin sesión.
 *
 * Los límites del plan no viven aquí sino en `shared/billing/plan-limits.ts`,
 * porque se aplican donde se crea lo que el plan acota.
 */
@Module({
  controllers: [
    PlatformController,
    PlatformUsersController,
    PublicPlansController,
    PublicBillingController,
    SubscriptionsController,
    PaymentEventsController,
  ],
  providers: [
    PlatformService,
    PlatformDashboardService,
    PlatformUsersService,
    StoreDeletionService,
    SubscriptionsService,
  ],
})
export class PlatformModule {}
