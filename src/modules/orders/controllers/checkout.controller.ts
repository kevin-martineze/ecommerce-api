import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CartQuoteDto,
  CartQuoteResultDto,
  CreateOrderDto,
  OrderCreatedDto,
  OrderTokenQueryDto,
  PublicOrderDto,
  PublicShippingZoneDto,
} from '@shared/dtos/orders/checkout.dto';

import { CheckoutService } from '../providers/checkout.service';

/** Letras, números, guion y guion bajo: lo que genera cualquier cliente con un UUID o un nanoid. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Carrito y pedidos de la tienda pública. Sin autenticación.
 *
 * Sin límite por IP salvo al crear el pedido: ver la nota de límites en
 * ARCHITECTURE.md § 3.
 */
@ApiTags('tienda pública')
@SkipThrottle()
@Controller('public/:storeSlug')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get('shipping-zones')
  @ApiOperation({ summary: 'Zonas de envío activas, para elegir en el carrito.' })
  shippingZones(@Param('storeSlug') storeSlug: string): Promise<PublicShippingZoneDto[]> {
    return this.checkout.shippingZones(storeSlug);
  }

  @Post('cart/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cotiza el carrito: precios y stock de hoy, cupón y envío.' })
  quote(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CartQuoteDto,
  ): Promise<CartQuoteResultDto> {
    return this.checkout.quote(storeSlug, dto);
  }

  @Post('orders')
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Repetir el envío con la misma clave devuelve el mismo pedido.',
  })
  @ApiOperation({
    summary: 'Crea el pedido. 409 out_of_stock con el detalle si algo se agotó.',
  })
  create(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderCreatedDto> {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException('La clave de idempotencia no es válida.');
    }

    return this.checkout.createOrder(storeSlug, dto, idempotencyKey ?? null);
  }

  @Get('orders/:number')
  @ApiOperation({ summary: 'El pedido, tal como lo ve la clienta. Exige el token del enlace.' })
  publicOrder(
    @Param('storeSlug') storeSlug: string,
    @Param('number', ParseIntPipe) number: number,
    @Query() query: OrderTokenQueryDto,
  ): Promise<PublicOrderDto> {
    return this.checkout.publicOrder(storeSlug, number, query.token);
  }

  @Post('orders/:number/whatsapp-opened')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca que la clienta abrió el chat. Exige el token del enlace.' })
  async markWhatsappOpened(
    @Param('storeSlug') storeSlug: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: OrderTokenQueryDto,
  ): Promise<void> {
    await this.checkout.markWhatsappOpened(storeSlug, number, dto.token);
  }
}
