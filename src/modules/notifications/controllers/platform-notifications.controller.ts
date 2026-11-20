import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { PlatformRoute } from '@shared/decorators/platform-route.decorator';
import {
  NotificationListDto,
  NotificationReadDto,
  PushKeyDto,
  StreamTicketDto,
  PlatformNotificationDto,
} from '@shared/dtos/notifications/notifications.dto';
import { ZodPipe } from '@shared/validation/zod-pipe';

import {
  MarkNotificationsReadInput,
  markNotificationsReadSchema,
  NotificationListQuery,
  notificationListQuerySchema,
  PushSubscriptionInput,
  pushSubscriptionSchema,
  RemovePushSubscriptionInput,
  removePushSubscriptionSchema,
} from '../notifications.schemas';
import { NotificationsService } from '../providers/notifications.service';
import { PushService } from '../providers/push.service';
import { StreamTicketsService } from '../providers/stream-tickets.service';

/** La bandeja de avisos de la consola. Solo administradores de la plataforma. */
@ApiTags('plataforma')
@PlatformRoute()
@Controller('platform/notifications')
export class PlatformNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tickets: StreamTicketsService,
    private readonly push: PushService,
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

  @Get('push-key')
  @ApiOperation({ summary: 'Llave pública VAPID para suscribirse a push. Null si no hay push.' })
  pushKey(): PushKeyDto {
    return { publicKey: this.push.publicKey };
  }

  @Put('push-subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Este navegador recibe por push los avisos de la consola.' })
  async subscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(pushSubscriptionSchema)) input: PushSubscriptionInput,
  ): Promise<void> {
    await this.push.subscribe(user.id, null, input);
  }

  @Delete('push-subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Este navegador deja de recibir por push los avisos de la consola.' })
  async unsubscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(removePushSubscriptionSchema)) input: RemovePushSubscriptionInput,
  ): Promise<void> {
    await this.push.unsubscribe(user.id, null, input.endpoint);
  }
}
