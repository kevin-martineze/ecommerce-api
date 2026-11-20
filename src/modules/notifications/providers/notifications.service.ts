import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationListDto,
  NotificationReadDto,
  PlatformNotificationDto,
  StoreNotificationDto,
} from '@shared/dtos/notifications/notifications.dto';
import {
  NotificationBus,
  platformChannel,
  storeChannel,
} from '@shared/notifications/notification-bus';
import {
  PlatformNotificationEvent,
  platformNotificationEventSchema,
  StoreNotificationEvent,
  storeNotificationEventSchema,
} from '@shared/notifications/notification-events';
import { PrismaService } from '@db/prisma.service';

import { MarkNotificationsReadInput, NotificationListQuery } from '../notifications.schemas';

import { present, toPlatformNotificationDto, toStoreNotificationDto } from './notification-mapping';
import { PushDelivery, PushService } from './push.service';

/**
 * La bandeja de avisos: quién recibe cada uno, guardarlo y repartirlo.
 *
 * Los disparadores (pedidos, registro, cobros, soporte) llaman a `notifyStore`
 * o `notifyPlatform` DESPUÉS de confirmar su transacción, nunca dentro de
 * `forStore`. Si el aviso fallara dentro, revertiría el pedido; si se publicara
 * dentro y la transacción se revirtiera después, avisaría de un pedido que no
 * existe.
 *
 * Cada aviso sale por tres lados: la bandeja (la fila), el stream (el bus) y
 * los navegadores suscritos a push (`PushService`, sin esperar).
 *
 * Por lo mismo, `notify*` nunca lanza: un aviso perdido es una molestia, un
 * pedido que no se guardó por culpa del aviso es una venta perdida. Se
 * registra el id de la tienda y el tipo, nada más.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: NotificationBus,
    private readonly push: PushService,
  ) {}

  /**
   * A cada miembro de la tienda. Dueña y personal reciben lo mismo: los dos
   * ven pedidos. Una cuenta deshabilitada no recibe nada.
   */
  async notifyStore(storeId: string, event: StoreNotificationEvent): Promise<void> {
    try {
      const parsed = storeNotificationEventSchema.safeParse(event);

      if (!parsed.success) {
        this.logger.warn(`Aviso ${event.type} de la tienda ${storeId} con datos inválidos.`);

        return;
      }

      const { type, data } = parsed.data;

      const rows = await this.prisma.forStore(storeId, async (tx) => {
        const members = await tx.storeMember.findMany({
          where: { storeId, user: { disabledAt: null } },
          select: { userId: true },
        });

        if (members.length === 0) {
          return [];
        }

        return tx.storeNotification.createManyAndReturn({
          data: members.map((member) => ({ storeId, userId: member.userId, type, data })),
        });
      });

      const deliveries: PushDelivery[] = [];

      for (const row of rows) {
        const dto = toStoreNotificationDto(row);

        if (dto) {
          this.bus.publish(storeChannel(storeId, row.userId), dto);
          deliveries.push({ userId: row.userId, notification: dto });
        }
      }

      this.push.deliver(storeId, deliveries);
    } catch {
      this.logger.warn(`No se pudo guardar el aviso ${event.type} de la tienda ${storeId}.`);
    }
  }

  /** A cada persona que administra la plataforma con la cuenta activa. */
  async notifyPlatform(event: PlatformNotificationEvent): Promise<void> {
    try {
      const parsed = platformNotificationEventSchema.safeParse(event);

      if (!parsed.success) {
        this.logger.warn(`Aviso ${event.type} de la plataforma con datos inválidos.`);

        return;
      }

      const { type, data } = parsed.data;

      const admins = await this.prisma.platformAdmin.findMany({
        where: { user: { disabledAt: null } },
        select: { userId: true },
      });

      if (admins.length === 0) {
        return;
      }

      const rows = await this.prisma.platformNotification.createManyAndReturn({
        data: admins.map((admin) => ({ userId: admin.userId, type, data })),
      });

      const deliveries: PushDelivery[] = [];

      for (const row of rows) {
        const dto = toPlatformNotificationDto(row);

        if (dto) {
          this.bus.publish(platformChannel(row.userId), dto);
          deliveries.push({ userId: row.userId, notification: dto });
        }
      }

      this.push.deliver(null, deliveries);
    } catch {
      this.logger.warn(`No se pudo guardar el aviso ${event.type} de la plataforma.`);
    }
  }

  /** La bandeja de una persona en una tienda. */
  async listForStore(
    storeId: string,
    userId: string,
    query: NotificationListQuery,
  ): Promise<NotificationListDto<StoreNotificationDto>> {
    const { rows, unread } = await this.prisma.forStore(storeId, async (tx) => ({
      rows: await tx.storeNotification.findMany({
        where: { storeId, userId },
        // El id desempata dos avisos del mismo instante.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      }),
      unread: await tx.storeNotification.count({ where: { storeId, userId, readAt: null } }),
    }));

    return page(rows, query.limit, unread, toStoreNotificationDto);
  }

  /** Sin `ids`, marca leída toda la bandeja de esa persona en esa tienda. */
  async markStoreRead(
    storeId: string,
    userId: string,
    input: MarkNotificationsReadInput,
  ): Promise<NotificationReadDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      await tx.storeNotification.updateMany({
        where: { storeId, userId, readAt: null, ...(input.ids ? { id: { in: input.ids } } : {}) },
        data: { readAt: new Date() },
      });

      return {
        unread: await tx.storeNotification.count({ where: { storeId, userId, readAt: null } }),
      };
    });
  }

  /** La bandeja de una persona en la consola. */
  async listForPlatform(
    userId: string,
    query: NotificationListQuery,
  ): Promise<NotificationListDto<PlatformNotificationDto>> {
    const [rows, unread] = await Promise.all([
      this.prisma.platformNotification.findMany({
        where: { userId },
        // El id desempata dos avisos del mismo instante.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      }),
      this.prisma.platformNotification.count({ where: { userId, readAt: null } }),
    ]);

    return page(rows, query.limit, unread, toPlatformNotificationDto);
  }

  async markPlatformRead(
    userId: string,
    input: MarkNotificationsReadInput,
  ): Promise<NotificationReadDto> {
    await this.prisma.platformNotification.updateMany({
      where: { userId, readAt: null, ...(input.ids ? { id: { in: input.ids } } : {}) },
      data: { readAt: new Date() },
    });

    return {
      unread: await this.prisma.platformNotification.count({ where: { userId, readAt: null } }),
    };
  }
}

/**
 * Se pide una fila de más para saber si hay página siguiente sin contar todo.
 * El cursor es el id de la última fila mostrada.
 */
function page<
  Row extends { id: string },
  Dto extends StoreNotificationDto | PlatformNotificationDto,
>(
  rows: Row[],
  limit: number,
  unread: number,
  map: (row: Row) => Dto | null,
): NotificationListDto<Dto> {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);

  return {
    items: visible.map(map).filter(present),
    unread,
    nextBefore: rows.length > limit && last ? last.id : null,
  };
}
