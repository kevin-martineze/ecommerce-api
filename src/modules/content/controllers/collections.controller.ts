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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  CollectionAdminDto,
  CreateCollectionDto,
  DeleteCollectionResultDto,
  SetCollectionProductDto,
  UpdateCollectionDto,
  UpdateCollectionResultDto,
} from '@shared/dtos/content/collection.dto';

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
  @ApiOperation({ summary: 'Cambia datos o foto. Si reemplaza la foto, devuelve la ruta vieja.' })
  update(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<UpdateCollectionResultDto> {
    return this.collections.update(storeId, collectionId, dto);
  }

  @Delete(':collectionId')
  @ApiOperation({ summary: 'Borra la colección y devuelve la ruta de su foto para borrarla.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('collectionId', ParseUUIDPipe) collectionId: string,
  ): Promise<DeleteCollectionResultDto> {
    return this.collections.remove(storeId, collectionId);
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
