import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PlatformNotificationDto,
  StoreNotificationDto,
} from '@shared/dtos/notifications/notifications.dto';
import {
  platformNotificationEventSchema,
  storeNotificationEventSchema,
} from '@shared/notifications/notification-events';

const logger = new Logger('NotificationMapping');

interface NotificationRow {
  id: string;
  type: string;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Fila de la base → aviso. Null si `data` ya no tiene la forma de su tipo: se
 * descarta esa fila y la bandeja se muestra igual. Se registra solo el id.
 */
export function toStoreNotificationDto(row: NotificationRow): StoreNotificationDto | null {
  const parsed = storeNotificationEventSchema.safeParse({ type: row.type, data: row.data });

  if (!parsed.success) {
    logger.warn(`El aviso ${row.id} no tiene la forma de su tipo; se omite.`);

    return null;
  }

  return { ...meta(row), ...parsed.data };
}

export function toPlatformNotificationDto(row: NotificationRow): PlatformNotificationDto | null {
  const parsed = platformNotificationEventSchema.safeParse({ type: row.type, data: row.data });

  if (!parsed.success) {
    logger.warn(`El aviso ${row.id} no tiene la forma de su tipo; se omite.`);

    return null;
  }

  return { ...meta(row), ...parsed.data };
}

function meta(row: NotificationRow): { id: string; createdAt: string; readAt: string | null } {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

/** Quita los null de una lista mapeada sin castear. */
export function present<T>(value: T | null): value is T {
  return value !== null;
}
