import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedWithoutSubscription } from '@shared/decorators/billing-route.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  ActivatePlanDto,
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
