import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  CreateVariantDto,
  DeleteVariantResultDto,
  GenerateVariantsDto,
  GenerateVariantsResultDto,
  UpdateVariantDto,
  VariantDto,
} from '@shared/dtos/catalog/variant.dto';

import { VariantsService } from '../providers/variants.service';

/**
 * Las variantes se CREAN colgando de su prenda y se EDITAN por su propio id.
 *
 * Crear exige nombrar la prenda porque la matriz es de una prenda. Editar
 * stock no: la pantalla de inventario cambia variantes de muchas prendas a la
 * vez y no tiene por qué cargar con el id de cada una.
 */
@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId')
export class VariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Post('products/:productId/variants')
  @ApiOperation({ summary: 'Crea las combinaciones color × talla que falten. Nunca borra.' })
  generate(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: GenerateVariantsDto,
  ): Promise<GenerateVariantsResultDto> {
    return this.variants.generate(storeId, productId, dto);
  }
  // Ruta aparte de la de generar: una crea TODAS las combinaciones que faltan
  // y la otra crea UNA concreta. Compartir verbo y URL obligaría a adivinar
  // cuál se quiso por la forma del cuerpo.
  @Post('products/:productId/variants/one')
  @ApiOperation({ summary: 'Crea una combinación concreta, eligiendo un valor por eje.' })
  create(
    @Param('storeId') storeId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<VariantDto> {
    return this.variants.create(storeId, productId, dto);
  }

  @Patch('variants/:variantId')
  @ApiOperation({ summary: 'Cambia stock, precio propio o visibilidad de una variante.' })
  update(
    @Param('storeId') storeId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<VariantDto> {
    return this.variants.update(storeId, variantId, dto);
  }

  @Delete('variants/:variantId')
  @ApiOperation({ summary: 'Borra la variante, o la desactiva en cero si ya está en pedidos.' })
  remove(
    @Param('storeId') storeId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ): Promise<DeleteVariantResultDto> {
    return this.variants.remove(storeId, variantId);
  }
}
