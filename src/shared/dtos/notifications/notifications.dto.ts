/**
 * Lo que devuelve la bandeja de avisos, en el panel y en la consola.
 *
 * El frontend lo lee con zod (`$lib/server/api/panel-notifications.ts` y
 * `platform-notifications.ts`); si un campo cambia aquí, se cambia también el
 * esquema de allá.
 */
import type {
  PlatformNotificationEvent,
  StoreNotificationEvent,
} from '@shared/notifications/notification-events';

interface NotificationMeta {
  id: string;
  createdAt: string;
  /** Null: sin leer. */
  readAt: string | null;
}

/** Un aviso: `type` decide la forma de `data`. */
export type StoreNotificationDto = NotificationMeta & StoreNotificationEvent;
export type PlatformNotificationDto = NotificationMeta & PlatformNotificationEvent;
export type NotificationDto = StoreNotificationDto | PlatformNotificationDto;

export interface NotificationListDto<T extends NotificationDto> {
  /** De la más nueva a la más vieja. */
  items: T[];
  /** No leídos de esta persona en esta bandeja, no solo de la página. */
  unread: number;
  /** Cursor para pedir la página siguiente (`?before=`). Null: no hay más. */
  nextBefore: string | null;
}

export interface NotificationReadDto {
  /** No leídos que quedan después de marcar. */
  unread: number;
}

/** Con qué abrir el stream de avisos desde el navegador. */
export interface StreamTicketDto {
  /** `EventSource(url + '?ticket=…')`. */
  url: string;
  /** JWT de un solo uso práctico: sirve 60 s y solo para abrir el stream. */
  ticket: string;
  expiresAt: string;
}
