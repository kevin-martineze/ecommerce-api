import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  CouponAdminDto,
  CreateCouponDto,
  CreateShippingZoneDto,
  DeactivateOrDeleteResultDto,
  RestockRequestAdminDto,
  ShippingZoneAdminDto,
  UpdateCouponDto,
  UpdateRestockRequestDto,
  UpdateShippingZoneDto,
} from '@shared/dtos/commerce/commerce.dto';

import { CouponsService } from '../providers/coupons.service';
import { RestockRequestsService } from '../providers/restock-requests.service';
import { ShippingZonesService } from '../providers/shipping-zones.service';

/** Cupones, zonas de envío y avisos de reposición: lo que alimenta el carrito y lo que deja. */
@ApiTags('comercio')
@StoreRoute()
@Controller('stores/:storeId')
export class CommerceController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly zones: ShippingZonesService,
    private readonly restock: RestockRequestsService,
  ) {}

  @Get('coupons')
  @ApiOperation({ summary: 'Cupones de la tienda, los más nuevos primero.' })
  listCoupons(@Param('storeId') storeId: string): Promise<CouponAdminDto[]> {
    return this.coupons.list(storeId);
  }

  @Post('coupons')
  @ApiOperation({ summary: 'Crea un cupón. 409 si el código ya existe.' })
  createCoupon(
    @Param('storeId') storeId: string,
    @Body() dto: CreateCouponDto,
  ): Promise<CouponAdminDto> {
    return this.coupons.create(storeId, dto);
  }

  @Patch('coupons/:couponId')
  @ApiOperation({ summary: 'Cambia valor, fechas, límite o si está activo.' })
  updateCoupon(
    @Param('storeId') storeId: string,
    @Param('couponId', ParseUUIDPipe) couponId: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<CouponAdminDto> {
    return this.coupons.update(storeId, couponId, dto);
  }

  @Delete('coupons/:couponId')
  @ApiOperation({ summary: 'Borra el cupón, o lo desactiva si ya se usó.' })
  removeCoupon(
    @Param('storeId') storeId: string,
    @Param('couponId', ParseUUIDPipe) couponId: string,
  ): Promise<DeactivateOrDeleteResultDto> {
    return this.coupons.remove(storeId, couponId);
  }

  @Get('shipping-zones')
  @ApiOperation({ summary: 'Zonas de envío, incluidas las inactivas.' })
  listZones(@Param('storeId') storeId: string): Promise<ShippingZoneAdminDto[]> {
    return this.zones.list(storeId);
  }

  @Post('shipping-zones')
  @ApiOperation({ summary: 'Crea una zona de envío.' })
  createZone(
    @Param('storeId') storeId: string,
    @Body() dto: CreateShippingZoneDto,
  ): Promise<ShippingZoneAdminDto> {
    return this.zones.create(storeId, dto);
  }

  @Patch('shipping-zones/:zoneId')
  @ApiOperation({ summary: 'Cambia nombre, costo, días, orden o si está activa.' })
  updateZone(
    @Param('storeId') storeId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: UpdateShippingZoneDto,
  ): Promise<ShippingZoneAdminDto> {
    return this.zones.update(storeId, zoneId, dto);
  }

  @Delete('shipping-zones/:zoneId')
  @ApiOperation({ summary: 'Borra la zona, o la desactiva si ya se usó en pedidos.' })
  removeZone(
    @Param('storeId') storeId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
  ): Promise<DeactivateOrDeleteResultDto> {
    return this.zones.remove(storeId, zoneId);
  }

  @Get('restock-requests')
  @ApiOperation({ summary: 'Avisos de reposición, los más nuevos primero.' })
  listRestock(@Param('storeId') storeId: string): Promise<RestockRequestAdminDto[]> {
    return this.restock.list(storeId);
  }

  @Patch('restock-requests/:requestId')
  @ApiOperation({ summary: 'Marca un aviso como enviado, o lo vuelve a pendiente.' })
  updateRestock(
    @Param('storeId') storeId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: UpdateRestockRequestDto,
  ): Promise<RestockRequestAdminDto> {
    return this.restock.update(storeId, requestId, dto);
  }
}
