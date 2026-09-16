import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { StoreSettingsDto, UpdateStoreSettingsDto } from '@shared/dtos/content/settings.dto';

import { StoreSettingsService } from '../providers/store-settings.service';

@ApiTags('contenido')
@StoreRoute()
@Controller('stores/:storeId/settings')
export class StoreSettingsController {
  constructor(private readonly settings: StoreSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Ajustes de la tienda y textos de la portada.' })
  get(@Param('storeId') storeId: string): Promise<StoreSettingsDto> {
    return this.settings.get(storeId);
  }

  @Patch()
  @ApiOperation({ summary: 'Cambia ajustes o portada. Solo lo que viene.' })
  update(
    @Param('storeId') storeId: string,
    @Body() dto: UpdateStoreSettingsDto,
  ): Promise<StoreSettingsDto> {
    return this.settings.update(storeId, dto);
  }
}
