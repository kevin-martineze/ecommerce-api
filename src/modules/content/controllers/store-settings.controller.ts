import { Body, Controller, Delete, Get, Param, Patch, Put, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { readUpload } from '@shared/media/upload';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  StoreSettingsDto,
  UpdateStoreSettingsDto,
  UploadLogoDto,
} from '@shared/dtos/content/settings.dto';

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

  @Put('logo')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadLogoDto })
  @ApiOperation({ summary: 'Sube el logo de la tienda. Reemplaza el anterior.' })
  async setLogo(
    @Param('storeId') storeId: string,
    @Req() request: FastifyRequest,
  ): Promise<StoreSettingsDto> {
    return this.settings.setLogo(storeId, await readUpload(request));
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Quita el logo. La tienda vuelve a mostrar el nombre.' })
  removeLogo(@Param('storeId') storeId: string): Promise<StoreSettingsDto> {
    return this.settings.removeLogo(storeId);
  }
}
