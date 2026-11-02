import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PlatformSupportListDto,
  PlatformSupportThreadDto,
  PlatformSupportTicketDto,
  SupportStatus,
} from '@shared/dtos/support/support.dto';
import { PrismaService, TenantClient } from '@db/prisma.service';

import { PlatformSupportQuery } from '../support.schemas';

import { SupportNotifier } from './support-notifier';
import { toMessageDto, toPlatformTicketDto } from './support-mapping';

/** Casos por página en la bandeja. */
const PAGE_SIZE = 20;

/**
 * Hasta cuántas tiendas recorre la bandeja. Igual que el listado de tiendas:
 * una plataforma con más ya necesita paginar en la base.
 */
const STORE_LIMIT = 200;

const STORE_NOT_FOUND = 'Esa tienda no existe.';
const TICKET_NOT_FOUND = 'Ese caso de soporte no existe.';

interface StoreRef {
  id: string;
  name: string;
  slug: string;
}

/**
 * El centro de soporte desde la plataforma: la bandeja del equipo y el hilo.
 *
 * `support_tickets` está bajo RLS, así que la bandeja no puede leerlo de una
 * sola vez: recorre las tiendas y lee cada una con `forStore`, igual que el
 * listado de tiendas. Es un costo que se acepta a propósito; abrir una política
 * de "plataforma ve todo" es el agujero que RLS existe para no tener.
 *
 * Los filtros por estado y por texto se aplican en memoria después de juntar
 * las tiendas. Con el límite de tiendas, el conjunto cabe.
 */
@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: SupportNotifier,
  ) {}

  async list(query: PlatformSupportQuery): Promise<PlatformSupportListDto> {
    const stores = await this.prisma.store.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: 'asc' },
      take: STORE_LIMIT,
    });

    const collected: PlatformSupportTicketDto[] = [];

    for (const store of stores) {
      const rows = await this.prisma.forStore(store.id, (tx) =>
        ticketsOfStore(tx, store, query.status),
      );

      collected.push(...rows);
    }

    const needle = query.q?.toLowerCase();
    const matching = needle
      ? collected.filter((ticket) =>
          [ticket.subject, ticket.storeName, ticket.storeSlug].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
      : collected;

    matching.sort(byPriority);

    const start = (query.page - 1) * PAGE_SIZE;

    return {
      tickets: matching.slice(start, start + PAGE_SIZE),
      total: matching.length,
      page: query.page,
      pageSize: PAGE_SIZE,
    };
  }

  async thread(storeId: string, ticketId: string): Promise<PlatformSupportThreadDto> {
    const store = await this.requireStore(storeId);

    return this.prisma.forStore(storeId, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id: ticketId, storeId },
        include: { openedBy: { select: { email: true } } },
      });

      if (!ticket) {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }

      // Abrir el hilo es leerlo: los mensajes de la dueña dejan de contar como nuevos.
      await tx.supportTicket.update({
        where: { id: ticketId, storeId },
        data: { teamLastReadAt: new Date() },
      });

      const messages = await tx.supportMessage.findMany({
        where: { ticketId, storeId },
        orderBy: { createdAt: 'asc' },
      });

      return {
        ticket: toPlatformTicketDto(ticket, store, ticket.openedBy?.email ?? null, 0),
        messages: messages.map(toMessageDto),
      };
    });
  }

  async reply(
    storeId: string,
    teamUserId: string,
    ticketId: string,
    body: string,
  ): Promise<PlatformSupportThreadDto> {
    const now = new Date();

    const opened = await this.prisma.forStore(storeId, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id: ticketId, storeId },
        select: {
          id: true,
          subject: true,
          openedBy: { select: { email: true } },
        },
      });

      if (!ticket) {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }

      await tx.supportMessage.create({
        data: { ticketId, storeId, author: 'TEAM', authorUserId: teamUserId, body },
      });

      // Contestar el equipo deja el caso en `ANSWERED`: ahora le toca a la dueña.
      await tx.supportTicket.update({
        where: { id: ticketId, storeId },
        data: { status: 'ANSWERED', lastMessageAt: now, teamLastReadAt: now },
      });

      return ticket;
    });

    // Sin correo de la cuenta que abrió el caso (se borró), no hay a quién avisar:
    // la dueña lo ve en su panel al entrar.
    const to = opened.openedBy?.email;

    if (to) {
      await this.notifier.teamReplied({ ticketId, to, subject: opened.subject });
    }

    return this.thread(storeId, ticketId);
  }

  async setStatus(
    storeId: string,
    ticketId: string,
    status: SupportStatus,
  ): Promise<PlatformSupportThreadDto> {
    await this.prisma.forStore(storeId, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id: ticketId, storeId },
        select: { id: true },
      });

      if (!ticket) {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }

      await tx.supportTicket.update({ where: { id: ticketId, storeId }, data: { status } });
    });

    return this.thread(storeId, ticketId);
  }

  private async requireStore(storeId: string): Promise<StoreRef> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, slug: true },
    });

    if (!store) {
      throw new NotFoundException(STORE_NOT_FOUND);
    }

    return store;
  }
}

/** Tickets de una tienda, mapeados para la bandeja. Corre dentro de `forStore`. */
async function ticketsOfStore(
  tx: TenantClient,
  store: StoreRef,
  status: SupportStatus | undefined,
): Promise<PlatformSupportTicketDto[]> {
  const tickets = await tx.supportTicket.findMany({
    where: { storeId: store.id, ...(status ? { status } : {}) },
    include: { openedBy: { select: { email: true } } },
  });

  const rows: PlatformSupportTicketDto[] = [];

  for (const ticket of tickets) {
    // Lo que la dueña escribió después de la última vez que el equipo abrió el hilo.
    const unread = await tx.supportMessage.count({
      where: {
        storeId: store.id,
        ticketId: ticket.id,
        author: 'OWNER',
        ...(ticket.teamLastReadAt ? { createdAt: { gt: ticket.teamLastReadAt } } : {}),
      },
    });

    rows.push(toPlatformTicketDto(ticket, store, ticket.openedBy?.email ?? null, unread));
  }

  return rows;
}

/**
 * Lo que espera respuesta primero, y entre esos, lo que lleva más tiempo esperando.
 * Lo demás va después, con lo más reciente arriba.
 */
function byPriority(a: PlatformSupportTicketDto, b: PlatformSupportTicketDto): number {
  const aWaits = a.status === 'OPEN' ? 0 : 1;
  const bWaits = b.status === 'OPEN' ? 0 : 1;

  if (aWaits !== bWaits) {
    return aWaits - bWaits;
  }

  return aWaits === 0
    ? a.lastMessageAt.localeCompare(b.lastMessageAt)
    : b.lastMessageAt.localeCompare(a.lastMessageAt);
}
