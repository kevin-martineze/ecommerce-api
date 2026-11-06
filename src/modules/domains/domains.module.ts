import { Module } from '@nestjs/common';

import { PublicStoreDomainController } from './controllers/public-store-domain.controller';
import { StoreDomainController } from './controllers/store-domain.controller';
import { PublicStoreDomainService } from './providers/public-store-domain.service';
import { StoreDomainService } from './providers/store-domain.service';

/** Dominio propio de cada tienda: el panel de la dueña y la resolución pública del host. */
@Module({
  controllers: [StoreDomainController, PublicStoreDomainController],
  providers: [StoreDomainService, PublicStoreDomainService],
})
export class DomainsModule {}
