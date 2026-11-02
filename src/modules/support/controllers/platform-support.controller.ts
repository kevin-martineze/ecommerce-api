import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { PlatformRoute } from '@shared/decorators/platform-route.decorator';
import { PlatformSupportListDto, PlatformSupportThreadDto } from '@shared/dtos/support/support.dto';
import { ZodPipe } from '@shared/validation/zod-pipe';

import {
  PlatformSupportQuery,
  platformSupportQuerySchema,
  ReplySupportInput,
  replySupportSchema,
  UpdateSupportStatusInput,
  updateSupportStatusSchema,
} from '../support.schemas';
import { PlatformSupportService } from '../providers/platform-support.service';

/** La bandeja del equipo de Globerce. Solo administradores de la plataforma. */
@ApiTags('plataforma')
@PlatformRoute()
@Controller('platform/support')
export class PlatformSupportController {
  constructor(private readonly support: PlatformSupportService) {}

  @Get('tickets')
  @ApiOperation({
    summary: 'Bandeja: casos de todas las tiendas, los que esperan respuesta primero.',
  })
  list(
    @Query(new ZodPipe(platformSupportQuerySchema)) query: PlatformSupportQuery,
  ): Promise<PlatformSupportListDto> {
    return this.support.list(query);
  }

  @Get('stores/:storeId/tickets/:ticketId')
  @ApiOperation({ summary: 'Hilo de un caso. Lo marca como leído por el equipo.' })
  thread(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<PlatformSupportThreadDto> {
    return this.support.thread(storeId, ticketId);
  }

  @Post('stores/:storeId/tickets/:ticketId/messages')
  @ApiOperation({ summary: 'Responde a la dueña. El caso queda en ANSWERED.' })
  reply(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(replySupportSchema)) input: ReplySupportInput,
  ): Promise<PlatformSupportThreadDto> {
    return this.support.reply(storeId, user.id, ticketId, input.body);
  }

  @Patch('stores/:storeId/tickets/:ticketId')
  @ApiOperation({ summary: 'Cambia el estado del caso: abierto, respondido o cerrado.' })
  setStatus(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body(new ZodPipe(updateSupportStatusSchema)) input: UpdateSupportStatusInput,
  ): Promise<PlatformSupportThreadDto> {
    return this.support.setStatus(storeId, ticketId, input.status);
  }
}
