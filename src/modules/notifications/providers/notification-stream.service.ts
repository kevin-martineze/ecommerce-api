import { ForbiddenException, Injectable } from '@nestjs/common';
import { NotificationDto } from '@shared/dtos/notifications/notifications.dto';
import { AccountDisabledException } from '@shared/errors/account-disabled';
import {
  NotificationChannel,
  platformChannel,
  storeChannel,
} from '@shared/notifications/notification-bus';
import { PrismaService } from '@db/prisma.service';

import { present, toPlatformNotificationDto, toStoreNotificationDto } from './notification-mapping';
import { StreamClaims } from './stream-tickets.service';

/** Cuántos avisos perdidos se reenvían al reconectar. Más que eso, se recarga la bandeja. */
const REPLAY_LIMIT = 50;

/**
 * Lo que el stream necesita de la base: quién puede abrirlo y qué se perdió.
 *
 * El ticket prueba quién es y para qué bandeja lo pidió hace menos de un
 * minuto. No prueba que siga teniendo acceso: entre que se emitió y que se usa
 * pudieron quitarla de la tienda o deshabilitar su cuenta. Por eso se vuelve a
 * mirar la base, igual que hacen los guards en cada petición.
 */
@Injectable()
export class NotificationStreamService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lanza 403 si ya no tiene acceso. Devuelve el canal del bus. */
  async authorize(claims: StreamClaims): Promise<NotificationChannel> {
    const { userId, scope } = claims;

    if (scope.kind === 'platform') {
      const admin = await this.prisma.platformAdmin.findUnique({
        where: { userId },
        select: { user: { select: { disabledAt: true } } },
      });

      if (!admin) {
        throw new ForbiddenException('Esta cuenta no administra la plataforma.');
      }

      if (admin.user.disabledAt) {
        throw new AccountDisabledException();
      }

      return platformChannel(userId);
    }

    const membership = await this.prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId: scope.storeId, userId } },
      select: { user: { select: { disabledAt: true } } },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes acceso a esta tienda.');
    }

    if (membership.user.disabledAt) {
      throw new AccountDisabledException();
    }

    return storeChannel(scope.storeId, userId);
  }

  /**
   * Los avisos posteriores a `afterId`, del más viejo al más nuevo, para
   * mandarlos en orden. Un id que no es de esta persona en esta bandeja no
   * encuentra ancla y no reenvía nada.
   */
  async missedSince(claims: StreamClaims, afterId: string): Promise<NotificationDto[]> {
    const { userId, scope } = claims;

    if (scope.kind === 'platform') {
      const anchor = await this.prisma.platformNotification.findFirst({
        where: { userId, id: afterId },
        select: { createdAt: true },
      });

      if (!anchor) {
        return [];
      }

      const rows = await this.prisma.platformNotification.findMany({
        where: {
          userId,
          OR: [
            { createdAt: { gt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { gt: afterId } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPLAY_LIMIT,
      });

      return rows.reverse().map(toPlatformNotificationDto).filter(present);
    }

    const { storeId } = scope;
    const rows = await this.prisma.forStore(storeId, async (tx) => {
      const anchor = await tx.storeNotification.findFirst({
        where: { storeId, userId, id: afterId },
        select: { createdAt: true },
      });

      if (!anchor) {
        return [];
      }

      // El orden de la bandeja desempata por id: "después" es más nuevo, o
      // del mismo instante con un id mayor.
      return tx.storeNotification.findMany({
        where: {
          storeId,
          userId,
          OR: [
            { createdAt: { gt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { gt: afterId } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPLAY_LIMIT,
      });
    });

    return rows.reverse().map(toStoreNotificationDto).filter(present);
  }
}
