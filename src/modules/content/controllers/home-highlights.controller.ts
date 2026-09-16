import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  CreateHomeHighlightDto,
  HomeHighlightAdminDto,
  UpdateHomeHighlightDto,
} from '@shared/dtos/content/home-highlight.dto';

import { HomeHighlightsService } from '../providers/home-highlights.service';

@ApiTags('contenido')
@StoreRoute()
@Controller('stores/:storeId/home-highlights')
export class HomeHighlightsController {
  constructor(private readonly highlights: HomeHighlightsService) {}

  @Get()
  @ApiOperation({ summary: 'Bloques de la portada, incluidos los ocultos.' })
  list(@Param('storeId') storeId: string): Promise<HomeHighlightAdminDto[]> {
    return this.highlights.list(storeId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un bloque de la portada.' })
  create(
    @Param('storeId') storeId: string,
    @Body() dto: CreateHomeHighlightDto,
  ): Promise<HomeHighlightAdminDto> {
    return this.highlights.create(storeId, dto);
  }

  @Patch(':highlightId')
  @ApiOperation({ summary: 'Cambia textos, orden o visibilidad de un bloque.' })
  update(
    @Param('storeId') storeId: string,
    @Param('highlightId', ParseUUIDPipe) highlightId: string,
    @Body() dto: UpdateHomeHighlightDto,
  ): Promise<HomeHighlightAdminDto> {
    return this.highlights.update(storeId, highlightId, dto);
  }

  @Delete(':highlightId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borra un bloque.' })
  async remove(
    @Param('storeId') storeId: string,
    @Param('highlightId', ParseUUIDPipe) highlightId: string,
  ): Promise<void> {
    await this.highlights.remove(storeId, highlightId);
  }
}
