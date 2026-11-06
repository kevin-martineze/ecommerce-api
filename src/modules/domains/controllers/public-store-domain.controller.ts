import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicStoreDomainDto } from '@shared/dtos/domains/domain.dto';

import { PublicStoreDomainService } from '../providers/public-store-domain.service';

/**
 * Qué tienda sirve un dominio propio. Fuera de `public/:storeSlug` para no
 * chocar con el parámetro del slug. Lectura pública, como el resto: sin límite
 * por IP, porque la tienda la llama desde su servidor.
 */
@ApiTags('tienda pública')
@SkipThrottle()
@Controller('store-domains')
export class PublicStoreDomainController {
  constructor(private readonly domains: PublicStoreDomainService) {}

  @Get(':host')
  @ApiOperation({ summary: 'Slug y estado de la tienda que sirve un dominio propio.' })
  resolve(@Param('host') host: string): Promise<PublicStoreDomainDto> {
    return this.domains.resolve(host);
  }
}
