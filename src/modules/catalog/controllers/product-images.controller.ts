import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { ProductImageDto } from '@shared/dtos/catalog/product.dto';
import {
  ReorderProductImagesDto,
  UploadProductImageDto,
} from '@shared/dtos/catalog/product-image.dto';
import { readUpload } from '@shared/media/upload';

import { ProductImagesService } from '../providers/product-images.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post('products/:productId/images')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadProductImageDto })
  @ApiOperation({ summary: 'Sube una foto: se convierte a WebP en tres tamaños y va al final.' })
  async upload(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: FastifyRequest,
  ): Promise<ProductImageDto> {
    return this.images.upload(storeId, productId, await readUpload(request));
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quita una foto y borra sus archivos.' })
  async remove(
    @Param('storeId') storeId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    await this.images.remove(storeId, imageId);
  }
}
