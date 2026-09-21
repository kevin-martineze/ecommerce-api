import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  ProductAttributeDto,
  ProductOptionDto,
  SetProductAttributesDto,
  SetProductOptionsDto,
} from '@shared/dtos/catalog/product-option.dto';

import { ProductOptionsService } from '../providers/product-options.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/products/:productId')
export class ProductOptionsController {
  constructor(private readonly options: ProductOptionsService) {}

  @Get('options')
  @ApiOperation({ summary: 'Los ejes del producto: Talla, Color, Molienda…' })
  list(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductOptionDto[]> {
    return this.options.list(storeId, productId);
  }

  // PUT y no PATCH: se manda la lista entera y queda esa. Un eje que no venga
  // se borra, y por eso la respuesta devuelve cómo quedó todo.
  @Put('options')
  @ApiOperation({ summary: 'Reemplaza los ejes del producto y sus valores.' })
  setOptions(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetProductOptionsDto,
  ): Promise<ProductOptionDto[]> {
    return this.options.setOptions(storeId, productId, dto);
  }

  @Get('attributes')
  @ApiOperation({ summary: 'Datos sueltos del producto: Material, ISBN, Origen…' })
  attributes(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductAttributeDto[]> {
    return this.options.attributes(storeId, productId);
  }

  @Put('attributes')
  @ApiOperation({ summary: 'Reemplaza los datos sueltos del producto.' })
  setAttributes(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetProductAttributesDto,
  ): Promise<ProductAttributeDto[]> {
    return this.options.setAttributes(storeId, productId, dto);
  }
}
