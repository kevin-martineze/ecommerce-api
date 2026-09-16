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
import { CreateSizeDto, SizeDto, UpdateSizeDto } from '@shared/dtos/catalog/size.dto';

import { SizesService } from '../providers/sizes.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/sizes')
export class SizesController {
  constructor(private readonly sizes: SizesService) {}

  @Get()
  @ApiOperation({ summary: 'Tallas de la tienda, en su orden.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: IncludeHiddenQueryDto,
  ): Promise<SizeDto[]> {
    return this.sizes.list(storeId, query.includeHidden ?? false);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una talla. 409 si ya existe.' })
  create(@Param('storeId') storeId: string, @Body() dto: CreateSizeDto): Promise<SizeDto> {
    return this.sizes.create(storeId, dto);
  }

  @Patch(':sizeId')
  @ApiOperation({ summary: 'Cambia etiqueta, orden o visibilidad.' })
  update(
    @Param('storeId') storeId: string,
    @Param('sizeId', ParseUUIDPipe) sizeId: string,
    @Body() dto: UpdateSizeDto,
  ): Promise<SizeDto> {
    return this.sizes.update(storeId, sizeId, dto);
  }

  @Delete(':sizeId')
  @ApiOperation({ summary: 'Borra la talla, o la oculta si alguna variante la usa.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('sizeId', ParseUUIDPipe) sizeId: string,
  ): Promise<RemovalResultDto> {
    return this.sizes.remove(storeId, sizeId);
  }
}
