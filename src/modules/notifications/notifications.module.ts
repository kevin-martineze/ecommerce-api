import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '@shared/config/env';
import { InMemoryNotificationBus, NotificationBus } from '@shared/notifications/notification-bus';

import { NotificationStreamController } from './controllers/notification-stream.controller';
import { PlatformNotificationsController } from './controllers/platform-notifications.controller';
import { StoreNotificationsController } from './controllers/store-notifications.controller';
import { NotificationStreamService } from './providers/notification-stream.service';
import { NotificationsService } from './providers/notifications.service';
import { StreamTicketsService } from './providers/stream-tickets.service';

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
  // El ticket del stream se firma con el mismo secreto que las sesiones, con
  // su propio `aud` (ver `StreamTicketsService`).
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [
    StoreNotificationsController,
    PlatformNotificationsController,
    NotificationStreamController,
  ],
  providers: [
    NotificationsService,
    NotificationStreamService,
    StreamTicketsService,
    { provide: NotificationBus, useClass: InMemoryNotificationBus },
  ],
  exports: [NotificationsService, NotificationBus],
})
export class NotificationsModule {}
