/**
 * Lo que el centro de soporte devuelve, para la dueña y para el equipo.
 *
 * El frontend lo lee con zod (`$lib/server/api/panel-support.ts`); si un campo
 * cambia aquí, se cambia también el esquema de allá.
 */

export type SupportCategory =
  'CONFIGURATION' | 'DOMAIN' | 'PAYMENTS' | 'PLAN' | 'PRODUCTS_ORDERS' | 'ERROR' | 'OTHER';

export type SupportStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

/** `OWNER`: la dueña de la tienda. `TEAM`: el equipo de Globerce. */
export type SupportAuthor = 'OWNER' | 'TEAM';

export interface SupportMessageDto {
  id: string;
  author: SupportAuthor;
  body: string;
  createdAt: string;
}

/** Vista de la dueña de un ticket: sin datos de otras tiendas ni de la cuenta del equipo. */
export interface StoreSupportTicketDto {
  id: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: string;
  lastMessageAt: string;
  /** Mensajes del equipo que la dueña todavía no abrió. */
  unreadReplies: number;
}

export interface StoreSupportListDto {
  tickets: StoreSupportTicketDto[];
  /** Suma de `unreadReplies` de todos los tickets: el contador del menú. */
  unreadReplies: number;
}

export interface StoreSupportThreadDto {
  ticket: StoreSupportTicketDto;
  messages: SupportMessageDto[];
}

/** Vista del equipo: añade la tienda y quién abrió el caso. */
export interface PlatformSupportTicketDto {
  id: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: string;
  lastMessageAt: string;
  /** Desde cuándo espera respuesta del equipo. Null si el caso no espera. */
  waitingSince: string | null;
  openedByEmail: string | null;
  /** Mensajes de la dueña que el equipo todavía no abrió. */
  unreadFromOwner: number;
}

export interface PlatformSupportListDto {
  tickets: PlatformSupportTicketDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformSupportThreadDto {
  ticket: PlatformSupportTicketDto;
  messages: SupportMessageDto[];
}
