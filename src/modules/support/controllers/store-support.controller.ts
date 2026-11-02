import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { StoreSupportListDto, StoreSupportThreadDto } from '@shared/dtos/support/support.dto';
import { ZodPipe } from '@shared/validation/zod-pipe';

import {
  createSupportTicketSchema,
  CreateSupportTicketInput,
  replySupportSchema,
  ReplySupportInput,
} from '../support.schemas';
import { StoreSupportService } from '../providers/store-support.service';

/**
 * El centro de soporte de la tienda. Solo la dueña: los casos hablan de la
 * cuenta, los cobros y el plan, que son decisiones de la dueña.
 */
@ApiTags('soporte')
@StoreRoute()
@Roles('OWNER')
@Controller('stores/:storeId/support')
export class StoreSupportController {
  constructor(private readonly support: StoreSupportService) {}

  @Get('tickets')
  @ApiOperation({ summary: 'Casos de soporte de la tienda, con los mensajes del equipo sin leer.' })
  list(@Param('storeId') storeId: string): Promise<StoreSupportListDto> {
    return this.support.list(storeId);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Abre un caso con su primer mensaje.' })
  create(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(createSupportTicketSchema)) input: CreateSupportTicketInput,
  ): Promise<StoreSupportThreadDto> {
    return this.support.create(storeId, user.id, input);
  }

  @Get('tickets/:ticketId')
  @ApiOperation({ summary: 'Hilo completo de un caso. Lo marca como leído.' })
  thread(
    @Param('storeId') storeId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<StoreSupportThreadDto> {
    return this.support.thread(storeId, ticketId);
  }

  @Post('tickets/:ticketId/messages')
  @ApiOperation({ summary: 'Escribe en un caso. Lo deja esperando al equipo.' })
  reply(
    @Param('storeId') storeId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(replySupportSchema)) input: ReplySupportInput,
  ): Promise<StoreSupportThreadDto> {
    return this.support.reply(storeId, user.id, ticketId, input.body);
  }
}
