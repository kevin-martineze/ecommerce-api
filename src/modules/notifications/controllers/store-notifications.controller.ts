import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  NotificationListDto,
  NotificationReadDto,
  PushKeyDto,
  StreamTicketDto,
  StoreNotificationDto,
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
    private readonly push: PushService,
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

  @Get('push-key')
  @ApiOperation({ summary: 'Llave pública VAPID para suscribirse a push. Null si no hay push.' })
  pushKey(): PushKeyDto {
    return { publicKey: this.push.publicKey };
  }

  @Put('push-subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Este navegador recibe por push los avisos de esta tienda.' })
  async subscribePush(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(pushSubscriptionSchema)) input: PushSubscriptionInput,
  ): Promise<void> {
    await this.push.subscribe(user.id, storeId, input);
  }

  @Delete('push-subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Este navegador deja de recibir por push los avisos de esta tienda.' })
  async unsubscribePush(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(removePushSubscriptionSchema)) input: RemovePushSubscriptionInput,
  ): Promise<void> {
    await this.push.unsubscribe(user.id, storeId, input.endpoint);
  }
}
