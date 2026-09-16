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
import {
  CreateProductDto,
  DeleteProductResultDto,
  ProductDetailDto,
  ProductListItemDto,
  ProductListQueryDto,
  UpdateProductDto,
} from '@shared/dtos/catalog/product.dto';

import { ProductsService } from '../providers/products.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Prendas de la tienda, las más nuevas primero. Hasta 200.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: ProductListQueryDto,
  ): Promise<ProductListItemDto[]> {
    return this.products.list(storeId, query.q);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Una prenda con sus fotos y su matriz de variantes.' })
  get(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductDetailDto> {
    return this.products.get(storeId, productId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una prenda. Sin slug, se deriva del nombre.' })
  create(
    @Param('storeId') storeId: string,
    @Body() dto: CreateProductDto,
  ): Promise<ProductDetailDto> {
    return this.products.create(storeId, dto);
  }

  @Patch(':productId')
  @ApiOperation({ summary: 'Cambia los datos de la prenda. Solo lo que viene.' })
  update(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDetailDto> {
    return this.products.update(storeId, productId, dto);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Borra la prenda, o la archiva si ya está en pedidos.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<DeleteProductResultDto> {
    return this.products.remove(storeId, productId);
  }
}
