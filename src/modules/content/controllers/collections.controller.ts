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
  Put,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { UploadHeroImageDto } from '@shared/dtos/catalog/product-image.dto';
import {
  CollectionAdminDto,
  CreateCollectionDto,
  SetCollectionProductDto,
  UpdateCollectionDto,
} from '@shared/dtos/content/collection.dto';
import { readUpload } from '@shared/media/upload';

import { CollectionsService } from '../providers/collections.service';

@ApiTags('contenido')
@StoreRoute()
@Controller('stores/:storeId/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @ApiOperation({ summary: 'Colecciones con sus prendas etiquetadas, incluidas las ocultas.' })
  list(@Param('storeId') storeId: string): Promise<CollectionAdminDto[]> {
    return this.collections.list(storeId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una colección. Sin slug, se deriva del nombre.' })
  create(
    @Param('storeId') storeId: string,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionAdminDto> {
    return this.collections.create(storeId, dto);
  }

  @Patch(':collectionId')
  @ApiOperation({ summary: 'Cambia nombre, descripción, orden o visibilidad.' })
  update(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionAdminDto> {
    return this.collections.update(storeId, collectionId, dto);
  }

  @Put(':collectionId/hero')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadHeroImageDto })
  @ApiOperation({ summary: 'Cambia la foto de portada. La anterior se borra.' })
  async setHero(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
    @Req() request: FastifyRequest,
  ): Promise<CollectionAdminDto> {
    return this.collections.setHero(storeId, collectionId, await readUpload(request));
  }

  @Delete(':collectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borra la colección y su foto.' })
  async remove(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
  ): Promise<void> {
    await this.collections.remove(storeId, collectionId);
  }

  @Put(':collectionId/products/:productId')
  @ApiOperation({ summary: 'Etiqueta una prenda en la colección, o mueve su punto.' })
  setProduct(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetCollectionProductDto,
  ): Promise<CollectionAdminDto> {
    return this.collections.setProduct(storeId, collectionId, productId, dto);
  }

  @Delete(':collectionId/products/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quita una prenda de la colección.' })
  async removeProduct(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.collections.removeProduct(storeId, collectionId, productId);
  }
}
