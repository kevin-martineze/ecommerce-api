import {
  PlatformSupportTicketDto,
  StoreSupportTicketDto,
  SupportAuthor,
  SupportCategory,
  SupportMessageDto,
  SupportStatus,
} from '@shared/dtos/support/support.dto';

/** Lo que de un ticket hace falta para mapearlo, sin depender del include de Prisma. */
export interface TicketRow {
  id: string;
  storeId: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface MessageRow {
  id: string;
  author: SupportAuthor;
  body: string;
  createdAt: Date;
}

export function toMessageDto(row: MessageRow): SupportMessageDto {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toStoreTicketDto(row: TicketRow, unreadReplies: number): StoreSupportTicketDto {
  return {
    id: row.id,
    subject: row.subject,
    category: row.category,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    unreadReplies,
  };
}

export function toPlatformTicketDto(
  row: TicketRow,
  store: { name: string; slug: string },
  openedByEmail: string | null,
  unreadFromOwner: number,
): PlatformSupportTicketDto {
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store.name,
    storeSlug: store.slug,
    subject: row.subject,
    category: row.category,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    // Solo espera el caso que quedó en `OPEN`: si ya contestó el equipo, no.
    waitingSince: row.status === 'OPEN' ? row.lastMessageAt.toISOString() : null,
    openedByEmail,
    unreadFromOwner,
  };
}
