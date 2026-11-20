import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  NotificationListDto,
  NotificationReadDto,
  StreamTicketDto,
  StoreNotificationDto,
} from '@shared/dtos/notifications/notifications.dto';
import { ZodPipe } from '@shared/validation/zod-pipe';

import {
  MarkNotificationsReadInput,
  markNotificationsReadSchema,
  NotificationListQuery,
  notificationListQuerySchema,
} from '../notifications.schemas';
import { NotificationsService } from '../providers/notifications.service';
import { StreamTicketsService } from '../providers/stream-tickets.service';

/**
 * La bandeja de avisos de quien trabaja en la tienda. Sin `@Roles`: dueña y
 * personal tienen cada una la suya, y `StoreRolesGuard` igual verifica la
 * membresía en cada petición.
 */
@ApiTags('avisos')
@StoreRoute()
@Controller('stores/:storeId/notifications')
export class StoreNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tickets: StreamTicketsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Avisos de esta persona en la tienda, del más nuevo al más viejo.' })
  list(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationListDto<StoreNotificationDto>> {
    return this.notifications.listForStore(storeId, user.id, query);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca avisos como leídos. Sin `ids`, todos.' })
  markRead(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(markNotificationsReadSchema)) input: MarkNotificationsReadInput,
  ): Promise<NotificationReadDto> {
    return this.notifications.markStoreRead(storeId, user.id, input);
  }

  @Post('stream-ticket')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ticket de 60 s para abrir el stream de avisos de esta tienda.' })
  streamTicket(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamTicketDto> {
    return this.tickets.issue(user.id, { kind: 'store', storeId });
  }
}
