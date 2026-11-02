import { Injectable, NotFoundException } from '@nestjs/common';
import {
  StoreSupportListDto,
  StoreSupportThreadDto,
  StoreSupportTicketDto,
} from '@shared/dtos/support/support.dto';
import { PrismaService, TenantClient } from '@db/prisma.service';

import { CreateSupportTicketInput } from '../support.schemas';

import { SupportNotifier } from './support-notifier';
import { toMessageDto, toStoreTicketDto } from './support-mapping';

const TICKET_NOT_FOUND = 'Ese caso de soporte no existe.';

/**
 * El centro de soporte desde la tienda: la dueña abre casos y los sigue.
 *
 * Todo va por `forStore`: RLS hace que un ticket de otra tienda no exista para
 * esta consulta, aunque alguien adivine su id.
 */
@Injectable()
export class StoreSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: SupportNotifier,
  ) {}

  async list(storeId: string): Promise<StoreSupportListDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const tickets = await tx.supportTicket.findMany({
        where: { storeId },
        orderBy: { lastMessageAt: 'desc' },
      });

      const rows: StoreSupportTicketDto[] = [];

      for (const ticket of tickets) {
        const unread = await countUnreadForOwner(tx, storeId, ticket.id, ticket.ownerLastReadAt);

        rows.push(toStoreTicketDto(ticket, unread));
      }

      return {
        tickets: rows,
        unreadReplies: rows.reduce((sum, ticket) => sum + ticket.unreadReplies, 0),
      };
    });
  }

  async create(
    storeId: string,
    userId: string,
    input: CreateSupportTicketInput,
  ): Promise<StoreSupportThreadDto> {
    const now = new Date();

    const ticketId = await this.prisma.forStore(storeId, async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          storeId,
          openedById: userId,
          subject: input.subject,
          category: input.category,
          status: 'OPEN',
          // Quien abre el caso ya lo leyó: sus propias palabras no cuentan como novedad.
          ownerLastReadAt: now,
          lastMessageAt: now,
          // storeId del mensaje lo completa la FK compuesta con el ticket.
          messages: {
            create: { author: 'OWNER', authorUserId: userId, body: input.body },
          },
        },
        select: { id: true },
      });

      return created.id;
    });

    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { name: true },
    });

    await this.notifier.ownerWrote({
      ticketId,
      storeId,
      storeName: store.name,
      subject: input.subject,
      isNew: true,
    });

    return this.thread(storeId, ticketId);
  }

  async thread(storeId: string, ticketId: string): Promise<StoreSupportThreadDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, storeId } });

      if (!ticket) {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }

      // Abrir el hilo es leerlo: los "sin leer" de este ticket se apagan.
      const now = new Date();

      await tx.supportTicket.update({
        where: { id: ticketId, storeId },
        data: { ownerLastReadAt: now },
      });

      const messages = await tx.supportMessage.findMany({
        where: { ticketId, storeId },
        orderBy: { createdAt: 'asc' },
      });

      return {
        ticket: toStoreTicketDto(ticket, 0),
        messages: messages.map(toMessageDto),
      };
    });
  }

  async reply(
    storeId: string,
    userId: string,
    ticketId: string,
    body: string,
  ): Promise<StoreSupportThreadDto> {
    const now = new Date();

    const ticket = await this.prisma.forStore(storeId, async (tx) => {
      const found = await tx.supportTicket.findFirst({
        where: { id: ticketId, storeId },
        select: { id: true, subject: true },
      });

      if (!found) {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }

      await tx.supportMessage.create({
        data: { ticketId, storeId, author: 'OWNER', authorUserId: userId, body },
      });

      // Escribir reabre el caso: si estaba cerrado, vuelve a esperar al equipo.
      await tx.supportTicket.update({
        where: { id: ticketId, storeId },
        data: { status: 'OPEN', lastMessageAt: now, ownerLastReadAt: now },
      });

      return found;
    });

    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { name: true },
    });

    await this.notifier.ownerWrote({
      ticketId,
      storeId,
      storeName: store.name,
      subject: ticket.subject,
      isNew: false,
    });

    return this.thread(storeId, ticketId);
  }
}

/** Mensajes del equipo posteriores a la última vez que la dueña abrió el hilo. */
export async function countUnreadForOwner(
  tx: TenantClient,
  storeId: string,
  ticketId: string,
  ownerLastReadAt: Date | null,
): Promise<number> {
  return tx.supportMessage.count({
    where: {
      storeId,
      ticketId,
      author: 'TEAM',
      ...(ownerLastReadAt ? { createdAt: { gt: ownerLastReadAt } } : {}),
    },
  });
}
