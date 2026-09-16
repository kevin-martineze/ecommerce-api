import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  DashboardDto,
  OrderDetailAdminDto,
  OrderListQueryDto,
  OrderPageDto,
  UpdateOrderDto,
} from '@shared/dtos/orders/order-admin.dto';

import { DashboardService } from '../providers/dashboard.service';
import { OrdersService } from '../providers/orders.service';

@ApiTags('pedidos')
@StoreRoute()
@Controller('stores/:storeId')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Resumen del panel: pendientes, ventas del mes, stock bajo y avisos.' })
  summary(@Param('storeId') storeId: string): Promise<DashboardDto> {
    return this.dashboard.get(storeId);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Pedidos, los más nuevos primero. Filtra por estado y busca.' })
  list(
    @Param('storeId') storeId: string,
    @Query() query: OrderListQueryDto,
  ): Promise<OrderPageDto> {
    return this.orders.list(storeId, query);
  }

  @Get('orders/number/:number')
  @ApiOperation({ summary: 'Un pedido por su número.' })
  byNumber(
    @Param('storeId') storeId: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<OrderDetailAdminDto> {
    return this.orders.byNumber(storeId, number);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Un pedido con sus líneas.' })
  detail(
    @Param('storeId') storeId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderDetailAdminDto> {
    return this.orders.detail(storeId, orderId);
  }

  @Patch('orders/:orderId')
  @ApiOperation({ summary: 'Cambia estado o notas. Cancelar devuelve stock y cupón.' })
  update(
    @Param('storeId') storeId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<OrderDetailAdminDto> {
    return this.orders.update(storeId, orderId, dto);
  }
}
