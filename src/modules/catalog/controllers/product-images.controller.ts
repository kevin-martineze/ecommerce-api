import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { ProductImageDto } from '@shared/dtos/catalog/product.dto';
import {
  AddProductImageDto,
  DeleteProductImageResultDto,
  ReorderProductImagesDto,
} from '@shared/dtos/catalog/product-image.dto';

import { ProductImagesService } from '../providers/product-images.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post('products/:productId/images')
  @ApiOperation({ summary: 'Registra una foto ya subida al almacenamiento. Va al final.' })
  add(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AddProductImageDto,
  ): Promise<ProductImageDto> {
    return this.images.add(storeId, productId, dto);
  }

  @Put('products/:productId/images/order')
  @ApiOperation({ summary: 'Reordena todas las fotos de la prenda. La primera es la principal.' })
  reorder(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderProductImagesDto,
  ): Promise<ProductImageDto[]> {
    return this.images.reorder(storeId, productId, dto.imageIds);
  }

  @Delete('product-images/:imageId')
  @ApiOperation({ summary: 'Quita una foto y devuelve la ruta del archivo para borrarlo.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<DeleteProductImageResultDto> {
    return this.images.remove(storeId, imageId);
  }
}
