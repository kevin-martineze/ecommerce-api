import { Module } from '@nestjs/common';

import { PublicStoreDomainController } from './controllers/public-store-domain.controller';
import { PublicStoreSlugController } from './controllers/public-store-slug.controller';
import { StoreDomainController } from './controllers/store-domain.controller';
import { DomainCheckService } from './providers/domain-check.service';
import { PublicStoreDomainService } from './providers/public-store-domain.service';
import { StoreDomainService } from './providers/store-domain.service';

/**
 * Dominio propio de cada tienda: el panel de la dueña y la resolución pública
 * del host. También a dónde se mudó una tienda que cambió de subdominio.
 */
@Module({
  controllers: [StoreDomainController, PublicStoreDomainController, PublicStoreSlugController],
  providers: [StoreDomainService, PublicStoreDomainService, DomainCheckService],
})
export class DomainsModule {}
