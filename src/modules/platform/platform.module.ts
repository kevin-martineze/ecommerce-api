import { Module } from '@nestjs/common';

import { PlatformController } from './controllers/platform.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PlatformService } from './providers/platform.service';
import { SubscriptionsService } from './providers/subscriptions.service';

/**
 * Plataforma: la superficie `/platform/*` de quien vende el software, y lo
 * que cada tienda ve de su propia suscripción.
 *
 * Los límites del plan no viven aquí sino en `shared/billing/plan-limits.ts`,
 * porque se aplican donde se crea lo que el plan acota.
 */
@Module({
  controllers: [PlatformController, SubscriptionsController],
  providers: [PlatformService, SubscriptionsService],
})
export class PlatformModule {}
