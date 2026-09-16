import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { PlatformRoute } from '@shared/decorators/platform-route.decorator';
import {
  ChangePlanDto,
  PlanDto,
  PlatformStoreDetailDto,
  PlatformStoreDto,
  PlatformStoreListQueryDto,
  ReconcileQueryDto,
  ReconcileResultDto,
  RecordPaymentDto,
  UpdateStoreStatusDto,
} from '@shared/dtos/platform/platform.dto';

import { PlatformService } from '../providers/platform.service';

@ApiTags('plataforma')
@PlatformRoute()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Planes comerciales.' })
  plans(): Promise<PlanDto[]> {
    return this.platform.listPlans();
  }

  @Get('stores')
  @ApiOperation({ summary: 'Tiendas con su plan, estado y dueñas. Hasta 200.' })
  stores(@Query() query: PlatformStoreListQueryDto): Promise<PlatformStoreDto[]> {
    return this.platform.listStores(query);
  }

  @Get('stores/:storeId')
  @ApiOperation({ summary: 'Una tienda con su suscripción y sus pagos.' })
  store(@Param('storeId', ParseUUIDPipe) storeId: string): Promise<PlatformStoreDetailDto> {
    return this.platform.getStore(storeId);
  }

  @Patch('stores/:storeId/status')
  @ApiOperation({ summary: 'Activa o suspende la tienda.' })
  setStatus(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: UpdateStoreStatusDto,
  ): Promise<PlatformStoreDetailDto> {
    return this.platform.setStatus(storeId, dto);
  }

  @Put('stores/:storeId/plan')
  @ApiOperation({ summary: 'Cambia el plan. Los límites nuevos aplican desde ya.' })
  changePlan(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: ChangePlanDto,
  ): Promise<PlatformStoreDetailDto> {
    return this.platform.changePlan(storeId, dto);
  }

  @Post('stores/:storeId/payments')
  @ApiOperation({ summary: 'Registra un pago a mano y extiende el período.' })
  recordPayment(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformStoreDetailDto> {
    return this.platform.recordPayment(storeId, dto, user.id);
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marca como vencidas las tiendas cuyo período terminó. Para un cron diario.',
  })
  reconcile(@Query() query: ReconcileQueryDto): Promise<ReconcileResultDto> {
    return this.platform.reconcile(new Date(), query.storeId);
  }
}
