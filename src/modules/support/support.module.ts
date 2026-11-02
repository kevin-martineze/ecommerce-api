import { Module } from '@nestjs/common';

import { PlatformSupportController } from './controllers/platform-support.controller';
import { StoreSupportController } from './controllers/store-support.controller';
import { PlatformSupportService } from './providers/platform-support.service';
import { StoreSupportService } from './providers/store-support.service';
import { SupportNotifier } from './providers/support-notifier';

/**
 * Centro de soporte: el canal entre cada tienda y el equipo de Globerce.
 *
 * Dos superficies: `/stores/:storeId/support/*` para la dueña y
 * `/platform/support/*` para el equipo. Los correos salen por el `Mailer` global.
 */
@Module({
  controllers: [StoreSupportController, PlatformSupportController],
  providers: [StoreSupportService, PlatformSupportService, SupportNotifier],
})
export class SupportModule {}
