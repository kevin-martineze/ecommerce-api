import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicStoreSlugDto } from '@shared/dtos/domains/domain.dto';

import { PublicStoreDomainService } from '../providers/public-store-domain.service';

/**
 * A dónde se mudó una tienda que cambió de subdominio. Fuera de
 * `public/:storeSlug` porque ese slug ya no es de ninguna tienda. Lectura
 * pública y sin límite por IP, como la de dominios propios.
 */
@ApiTags('tienda pública')
@SkipThrottle()
@Controller('store-slugs')
export class PublicStoreSlugController {
  constructor(private readonly domains: PublicStoreDomainService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'El subdominio actual de la tienda que antes usaba este.' })
  resolve(@Param('slug') slug: string): Promise<PublicStoreSlugDto> {
    return this.domains.resolveFormerSlug(slug);
  }
}
