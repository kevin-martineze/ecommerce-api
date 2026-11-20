import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OpenRoute } from '@shared/decorators/open-route.decorator';

import { StoreEventsService } from '../providers/store-events.service';

/**
 * Lo que la pasarela de UNA tienda nos cuenta sobre sus pedidos.
 *
 * La URL lleva la tienda porque cada una conecta su propia cuenta: es la que
 * la dueña pega en su panel de la pasarela. Saber a qué tienda apunta la URL
 * no autoriza nada —lo que autentica el evento es la firma, y se comprueba con
 * el secreto de ESA tienda—, así que apuntar a la tienda de otra no sirve de
 * nada: la firma no cuadraría.
 */
@ApiTags('pagos')
@Controller('payments/events')
export class StoreEventsController {
  constructor(private readonly events: StoreEventsService) {}

  @Post(':storeId')
  @OpenRoute()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Evento firmado de la pasarela de una tienda.' })
  async receive(
    @Param('storeId') storeId: string,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    if (!(await this.events.receive(storeId, body))) {
      throw new UnauthorizedException('No autorizado.');
    }

    return { received: true };
  }
}
