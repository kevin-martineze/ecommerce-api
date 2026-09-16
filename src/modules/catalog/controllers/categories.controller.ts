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
import {
  CategoryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '@shared/dtos/catalog/category.dto';

import { CategoriesService } from '../providers/categories.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Categorías de la tienda, en su orden.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: IncludeHiddenQueryDto,
  ): Promise<CategoryDto[]> {
    return this.categories.list(storeId, query.includeHidden ?? false);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una categoría. El slug se deriva del nombre.' })
  create(@Param('storeId') storeId: string, @Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.categories.create(storeId, dto);
  }

  @Patch(':categoryId')
  @ApiOperation({ summary: 'Cambia nombre, orden o visibilidad.' })
  update(
    @Param('storeId') storeId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categories.update(storeId, categoryId, dto);
  }

  @Delete(':categoryId')
  @ApiOperation({ summary: 'Borra la categoría. Sus prendas quedan sin categoría.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ): Promise<RemovalResultDto> {
    return this.categories.remove(storeId, categoryId);
  }
}
