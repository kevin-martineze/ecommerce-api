import { Global, Module } from '@nestjs/common';
import { InMemoryNotificationBus, NotificationBus } from '@shared/notifications/notification-bus';

import { PlatformNotificationsController } from './controllers/platform-notifications.controller';
import { StoreNotificationsController } from './controllers/store-notifications.controller';
import { NotificationsService } from './providers/notifications.service';

/**
 * Avisos del panel y de la consola: la bandeja y su reparto en vivo.
 *
 * Global como el correo: los disparadores viven en pedidos, cuenta, cobros y
 * soporte, y ninguno debería tener que importar este módulo para avisar.
 *
 * El bus es uno solo por proceso (ver `notification-bus.ts`): quien publica y
 * quien escucha tienen que ser la misma instancia.
 */
@Global()
@Module({
  controllers: [StoreNotificationsController, PlatformNotificationsController],
  providers: [
    NotificationsService,
    { provide: NotificationBus, useClass: InMemoryNotificationBus },
  ],
  exports: [NotificationsService, NotificationBus],
})
export class NotificationsModule {}
