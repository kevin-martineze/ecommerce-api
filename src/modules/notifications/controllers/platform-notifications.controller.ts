import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { PlatformRoute } from '@shared/decorators/platform-route.decorator';
import {
  NotificationListDto,
  NotificationReadDto,
  StreamTicketDto,
  PlatformNotificationDto,
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

/** La bandeja de avisos de la consola. Solo administradores de la plataforma. */
@ApiTags('plataforma')
@PlatformRoute()
@Controller('platform/notifications')
export class PlatformNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tickets: StreamTicketsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Avisos de la plataforma para esta persona, del más nuevo al más viejo.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationListDto<PlatformNotificationDto>> {
    return this.notifications.listForPlatform(user.id, query);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca avisos como leídos. Sin `ids`, todos.' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(markNotificationsReadSchema)) input: MarkNotificationsReadInput,
  ): Promise<NotificationReadDto> {
    return this.notifications.markPlatformRead(user.id, input);
  }

  @Post('stream-ticket')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ticket de 60 s para abrir el stream de avisos de la consola.' })
  streamTicket(@CurrentUser() user: AuthenticatedUser): Promise<StreamTicketDto> {
    return this.tickets.issue(user.id, { kind: 'platform' });
  }
}
