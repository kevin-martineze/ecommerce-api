import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrderCheckoutDto, PaymentLinkDto } from '@shared/dtos/payments/payments.dto';

import { OrderPaymentsService } from '../providers/order-payments.service';

/**
 * Pagar un pedido, desde la tienda pública.
 *
 * Lleva límite por IP como el resto de lo que puede crear algo: armar cobros
 * en cadena no le cuesta plata a nadie, pero sí llena la pasarela de
 * transacciones muertas.
 */
@ApiTags('tienda pública')
@Controller('public/:storeSlug/orders/:number/checkout')
export class OrderPaymentsController {
  constructor(private readonly payments: OrderPaymentsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Devuelve a dónde ir a pagar este pedido.' })
  checkout(
    @Param('storeSlug') storeSlug: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: OrderCheckoutDto,
  ): Promise<PaymentLinkDto> {
    return this.payments.checkout(storeSlug, number, dto);
  }
}
