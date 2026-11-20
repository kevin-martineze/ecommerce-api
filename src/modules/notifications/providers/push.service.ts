import { Injectable, Logger } from '@nestjs/common';
import {
  PlatformNotificationDto,
  StoreNotificationDto,
} from '@shared/dtos/notifications/notifications.dto';
import { PushSender } from '@shared/notifications/push-sender';
import { PrismaService } from '@db/prisma.service';

import { PushSubscriptionInput } from '../notifications.schemas';

/** A quién va un aviso y qué aviso es. */
export interface PushDelivery {
  userId: string;
  notification: StoreNotificationDto | PlatformNotificationDto;
}

/**
 * Avisos con el panel cerrado: los navegadores suscritos y el envío.
 *
 * Cada suscripción es de una bandeja: la de una tienda (`storeId`) o la de la
 * consola (`storeId` null). Así un aviso de la tienda A no llega al
 * navegador donde se activó solo la consola, y el enlace del aviso siempre es
 * del sitio donde se activó.
 *
 * Lo que viaja es el mismo aviso de la bandeja, sin datos de clientas; el
 * texto lo arma el service worker del frontend con su dominio, igual que la
 * campana. El servicio push lo recibe cifrado (RFC 8291).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
  ) {}

  /** La llave pública para suscribirse. Null: este entorno no manda push. */
  get publicKey(): string | null {
    return this.sender.publicKey;
  }

  /**
   * Guarda (o renueva) la suscripción de este navegador para esa bandeja.
   *
   * Si el mismo navegador estaba suscrito con OTRA cuenta, esas filas se
   * borran: el navegador cambió de manos y no debe seguir recibiendo los
   * avisos de quien estaba antes.
   */
  async subscribe(
    userId: string,
    storeId: string | null,
    input: PushSubscriptionInput,
  ): Promise<void> {
    const { endpoint } = input;

    await this.prisma.$transaction([
      this.prisma.pushSubscription.deleteMany({
        where: { endpoint, OR: [{ userId: { not: userId } }, { storeId }] },
      }),
      this.prisma.pushSubscription.create({
        data: {
          userId,
          storeId,
          endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
        },
      }),
    ]);
  }

  /** Deja de mandar avisos de esa bandeja a este navegador. */
  async unsubscribe(userId: string, storeId: string | null, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, storeId, endpoint } });
  }

  /**
   * Manda cada aviso a los navegadores suscritos a esa bandeja. Nunca lanza
   * y no se espera: quien avisa ya respondió.
   */
  deliver(storeId: string | null, deliveries: PushDelivery[]): void {
    if (!this.sender.publicKey || deliveries.length === 0) {
      return;
    }

    void this.send(storeId, deliveries).catch(() => {
      this.logger.warn(`No se pudieron mandar los avisos push de ${storeId ?? 'la consola'}.`);
    });
  }

  private async send(storeId: string | null, deliveries: PushDelivery[]): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { storeId, userId: { in: deliveries.map((delivery) => delivery.userId) } },
    });

    const gone: string[] = [];

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const delivery = deliveries.find((candidate) => candidate.userId === subscription.userId);

        if (!delivery) {
          return;
        }

        const outcome = await this.sender.send(subscription, JSON.stringify(delivery.notification));

        if (outcome === 'gone') {
          gone.push(subscription.id);
        }
      }),
    );

    // El navegador quitó el permiso o ya no existe: no se le vuelve a mandar.
    if (gone.length > 0) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    }
  }
}
