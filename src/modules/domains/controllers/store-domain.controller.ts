import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  StoreDomainDto,
  StoreDomainStateDto,
  UpsertStoreDomainDto,
} from '@shared/dtos/domains/domain.dto';
import { Param } from '@nestjs/common';

import { StoreDomainService } from '../providers/store-domain.service';

/** El dominio propio de la tienda. Solo la dueña: el resto del equipo no lo ve ni lo cambia. */
@ApiTags('dominio propio')
@StoreRoute()
@Roles('OWNER')
@Controller('stores/:storeId/domain')
export class StoreDomainController {
  constructor(private readonly domains: StoreDomainService) {}

  @Get()
  @ApiOperation({ summary: 'El dominio propio, su estado y los registros DNS que hay que poner.' })
  get(@Param('storeId') storeId: string): Promise<StoreDomainStateDto> {
    return this.domains.get(storeId);
  }

  @Put()
  @ApiOperation({ summary: 'Pone o cambia el dominio. Queda pendiente hasta verificar el DNS.' })
  save(
    @Param('storeId') storeId: string,
    @Body() dto: UpsertStoreDomainDto,
  ): Promise<StoreDomainDto> {
    return this.domains.save(storeId, dto.host);
  }

  /** Limitado: cada verificación consulta el DNS y el proveedor. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revisa el DNS del dominio y actualiza su estado.' })
  verify(@Param('storeId') storeId: string): Promise<StoreDomainDto> {
    return this.domains.verify(storeId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quita el dominio. Funciona también si el plan ya no lo incluye.' })
  async remove(@Param('storeId') storeId: string): Promise<void> {
    await this.domains.remove(storeId);
  }
}
