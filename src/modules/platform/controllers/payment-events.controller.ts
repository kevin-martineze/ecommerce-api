import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OpenRoute } from '@shared/decorators/open-route.decorator';
import { PaymentGateway } from '@shared/payments/gateway';
import { Inject } from '@nestjs/common';

import { SubscriptionsService } from '../providers/subscriptions.service';

/**
 * Lo que la pasarela nos cuenta.
 *
 * Es la única superficie de la API a la que llama alguien que no es nuestro
 * frontend, así que va `@OpenRoute()`: Wompi no conoce el secreto compartido y
 * no tiene por qué. Lo que la autentica es la firma del propio evento, que se
 * comprueba antes de mirar nada más.
 *
 * Responde 200 aunque el evento no nos sirva: una pasarela que recibe un error
 * reintenta, y reintentar un evento que igual vamos a ignorar solo llena el
 * log. Lo que se rechaza con 401 es lo que viene mal firmado, que es lo que de
 * verdad importa distinguir.
 */
@ApiTags('plataforma')
@Controller('payments')
export class PaymentEventsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway | null,
  ) {}

  @Post('events')
  @OpenRoute()
  @HttpCode(HttpStatus.OK)
  // Wompi reintenta; el límite es alto para no rechazar una ráfaga legítima.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Evento firmado de la pasarela: confirma o descarta un pago.' })
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    if (!this.gateway) {
      // Sin pasarela configurada nadie debería estar mandando eventos.
      throw new UnauthorizedException('No autorizado.');
    }

    const event = this.gateway.parseEvent(body);

    if (!event) {
      throw new UnauthorizedException('No autorizado.');
    }

    await this.subscriptions.applyPayment(event);

    return { received: true };
  }
}
