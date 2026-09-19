import { Module } from '@nestjs/common';

import { PlatformController } from './controllers/platform.controller';
import { PublicPlansController } from './controllers/public-plans.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PlatformDashboardService } from './providers/platform-dashboard.service';
import { PlatformService } from './providers/platform.service';
import { SubscriptionsService } from './providers/subscriptions.service';

/**
 * Plataforma: la superficie `/platform/*` de quien vende el software, lo que
 * cada tienda ve de su propia suscripción, y los planes que el sitio
 * comercial muestra sin sesión.
 *
 * Los límites del plan no viven aquí sino en `shared/billing/plan-limits.ts`,
 * porque se aplican donde se crea lo que el plan acota.
 */
@Module({
  controllers: [PlatformController, PublicPlansController, SubscriptionsController],
  providers: [PlatformService, PlatformDashboardService, SubscriptionsService],
})
export class PlatformModule {}
