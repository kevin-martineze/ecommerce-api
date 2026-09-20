import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { IncludeHiddenQueryDto, RemovalResultDto } from '@shared/dtos/catalog/catalog-common.dto';
import { ColorDto, CreateColorDto, UpdateColorDto } from '@shared/dtos/catalog/color.dto';

import { ColorsService } from '../providers/colors.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/colors')
export class ColorsController {
  constructor(private readonly colors: ColorsService) {}

  @Get()
  @ApiOperation({ summary: 'Colores de la tienda, en su orden.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: IncludeHiddenQueryDto,
  ): Promise<ColorDto[]> {
    return this.colors.list(storeId, query.includeHidden ?? false);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un color. El slug se deriva del nombre.' })
  create(@Param('storeId') storeId: string, @Body() dto: CreateColorDto): Promise<ColorDto> {
    return this.colors.create(storeId, dto);
  }

  @Patch(':colorId')
  @ApiOperation({ summary: 'Cambia nombre, tono, orden o visibilidad.' })
  update(
    @Param('storeId') storeId: string,
    @Param('colorId', ParseUUIDPipe) colorId: string,
    @Body() dto: UpdateColorDto,
  ): Promise<ColorDto> {
    return this.colors.update(storeId, colorId, dto);
  }

  @Delete(':colorId')
  @ApiOperation({ summary: 'Borra el color, o lo oculta si alguna variante lo usa.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('colorId', ParseUUIDPipe) colorId: string,
  ): Promise<RemovalResultDto> {
    return this.colors.remove(storeId, colorId);
  }
}
