import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedWithoutSubscription } from '@shared/decorators/billing-route.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  ActivatePlanDto,
  PaymentMethodDto,
  SavePaymentMethodDto,
  SubscriptionCheckoutDto,
  SubscriptionSummaryDto,
} from '@shared/dtos/platform/platform.dto';

import { SubscriptionsService } from '../providers/subscriptions.service';

@ApiTags('plataforma')
@StoreRoute()
@Controller('stores/:storeId/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'El plan de la tienda, hasta cuándo está pago y cuánto lleva usado.' })
  summary(@Param('storeId') storeId: string): Promise<SubscriptionSummaryDto> {
    return this.subscriptions.summary(storeId);
  }

  @Put('payment-method')
  @Roles('OWNER')
  // Se guarda justo cuando la prueba está por vencer, que es cuando el plan
  // vencido ya cerraría el resto del panel.
  @AllowedWithoutSubscription()
  @ApiOperation({
    summary: 'Guarda la tarjeta con que se cobrará el plan. No cobra nada.',
    description:
      'Recibe un token hecho en el navegador, no la tarjeta. El primer cobro es el día que ' +
      'termina la prueba, y lo hace la tarea diaria.',
  })
  savePaymentMethod(
    @Param('storeId') storeId: string,
    @Body() dto: SavePaymentMethodDto,
  ): Promise<PaymentMethodDto> {
    return this.subscriptions.savePaymentMethod(storeId, dto);
  }

  @Delete('payment-method')
  @Roles('OWNER')
  @AllowedWithoutSubscription()
  @ApiOperation({ summary: 'Deja de cobrar solo. Lo ya pagado se respeta.' })
  removePaymentMethod(@Param('storeId') storeId: string): Promise<PaymentMethodDto> {
    return this.subscriptions.removePaymentMethod(storeId);
  }

  @Post('checkout')
  @Roles('OWNER')
  // Es justo lo que hay que poder hacer con el plan vencido.
  @AllowedWithoutSubscription()
  @ApiOperation({
    summary: 'Empieza el cobro del plan y devuelve a dónde ir a pagar.',
  })
  checkout(
    @Param('storeId') storeId: string,
    @Body() dto: ActivatePlanDto,
  ): Promise<SubscriptionCheckoutDto> {
    return this.subscriptions.checkout(storeId, dto.planCode);
  }
}
