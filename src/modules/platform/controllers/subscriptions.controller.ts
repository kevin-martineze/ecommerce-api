import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { SubscriptionSummaryDto } from '@shared/dtos/platform/platform.dto';

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
}
