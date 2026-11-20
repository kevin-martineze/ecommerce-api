import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '@shared/config/env';
import { InMemoryNotificationBus, NotificationBus } from '@shared/notifications/notification-bus';
import { DisabledPushSender, PushSender, WebPushSender } from '@shared/notifications/push-sender';

import { NotificationStreamController } from './controllers/notification-stream.controller';
import { PlatformNotificationsController } from './controllers/platform-notifications.controller';
import { StoreNotificationsController } from './controllers/store-notifications.controller';
import { NotificationStreamService } from './providers/notification-stream.service';
import { NotificationsService } from './providers/notifications.service';
import { PushService } from './providers/push.service';
import { StreamTicketsService } from './providers/stream-tickets.service';

/**
 * Avisos del panel y de la consola: la bandeja, su reparto en vivo y el push
 * a los navegadores con el panel cerrado.
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
    PushService,
    { provide: NotificationBus, useClass: InMemoryNotificationBus },
    {
      // Sin las tres llaves VAPID no sale push; la validación del entorno
      // exige las tres o ninguna.
      provide: PushSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PushSender => {
        const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true });
        const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true });
        const subject = config.get('VAPID_SUBJECT', { infer: true });

        return publicKey && privateKey && subject
          ? new WebPushSender(publicKey, privateKey, subject)
          : new DisabledPushSender();
      },
    },
  ],
  exports: [NotificationsService, NotificationBus, PushSender],
})
export class NotificationsModule {}
