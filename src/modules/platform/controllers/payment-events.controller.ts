import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OpenRoute } from '@shared/decorators/open-route.decorator';
import { PaymentGateway } from '@shared/payments/gateway';
import { parseOrderReference } from '@modules/payments/providers/order-reference';
import { StoreEventsService } from '@modules/payments/providers/store-events.service';

import { SubscriptionsService } from '../providers/subscriptions.service';

/**
 * Lo que la pasarela nos cuenta.
 *
 * Es la única superficie de la API a la que llama alguien que no es nuestro
 * frontend, así que va `@OpenRoute()`: Wompi no conoce el secreto compartido y
 * no tiene por qué. Lo que la autentica es la firma del propio evento, que se
 * comprueba antes de mirar nada más.
 *
 * Wompi permite una sola URL de eventos por cuenta. Una tienda que cobra con
 * la misma cuenta que Globerce no tiene la suya, así que sus avisos llegan
 * acá: los de pedidos (`ord-<tienda>-<pedido>`) se le pasan a esa tienda, que
 * vuelve a comprobar la firma con su propio secreto; lo demás es mensualidad.
 *
 * Responde 200 aunque el evento no nos sirva: una pasarela que recibe un error
 * reintenta, y reintentar un evento que igual vamos a ignorar solo llena el
 * log. Lo que se rechaza con 401 es lo que viene mal firmado, que es lo que de
 * verdad importa distinguir.
 */
@ApiTags('plataforma')
@Controller('payments')
export class PaymentEventsController {
  private readonly logger = new Logger(PaymentEventsController.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly storeEvents: StoreEventsService,
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

    const order = parseOrderReference(event.reference);

    if (!order) {
      await this.subscriptions.applyPayment(event);

      return { received: true };
    }

    // Una referencia vieja no dice de qué tienda es: llegó acá por error.
    if (!order.storeId) {
      this.logger.warn(`Pago ${event.transactionId} de un pedido sin tienda en la referencia.`);

      return { received: true };
    }

    if (!(await this.storeEvents.receive(order.storeId, body))) {
      // La tienda cobra con otra cuenta: este aviso no es de ella.
      this.logger.warn(
        `Pago ${event.transactionId} de un pedido de una tienda con otra cuenta de pagos.`,
      );
    }

    return { received: true };
  }
}
