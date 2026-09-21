import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import { InventoryDto, InventoryQueryDto } from '@shared/dtos/catalog/inventory.dto';

import { InventoryService } from '../providers/inventory.service';

@ApiTags('catálogo')
@StoreRoute()
@Controller('stores/:storeId/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Para cambiar el stock se usa `PATCH /stores/:storeId/variants/:variantId`. */
  @Get()
  @ApiOperation({ summary: 'Stock por producto, empezando por lo que está por agotarse.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: InventoryQueryDto,
  ): Promise<InventoryDto> {
    return this.inventory.list(storeId, query.lowStock ?? false);
  }
}
