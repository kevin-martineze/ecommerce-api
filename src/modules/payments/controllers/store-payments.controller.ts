import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { ConnectPaymentsDto, PaymentAccountDto } from '@shared/dtos/payments/payments.dto';

import { StorePaymentsService } from '../providers/store-payments.service';

/**
 * La cuenta con la que la tienda cobra sus pedidos.
 *
 * Solo la dueña: son las llaves de su cuenta de comercio, y con ellas se mueve
 * su plata. El personal administra el catálogo, no la caja.
 */
@ApiTags('pagos')
@StoreRoute()
@Controller('stores/:storeId/payments')
export class StorePaymentsController {
  constructor(private readonly accounts: StorePaymentsService) {}

  @Get()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Si la tienda cobra en línea y con qué cuenta.' })
  get(@Param('storeId') storeId: string): Promise<PaymentAccountDto> {
    return this.accounts.get(storeId);
  }

  @Put()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Conecta (o reemplaza) las llaves de cobro de la tienda.' })
  connect(
    @Param('storeId') storeId: string,
    @Body() dto: ConnectPaymentsDto,
  ): Promise<PaymentAccountDto> {
    return this.accounts.connect(storeId, dto);
  }

  @Delete()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Deja de cobrar en línea. Las llaves quedan guardadas, inactivas.' })
  disconnect(@Param('storeId') storeId: string): Promise<PaymentAccountDto> {
    return this.accounts.disconnect(storeId);
  }
}
