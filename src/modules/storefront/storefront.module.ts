import { Module } from '@nestjs/common';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { StorefrontCatalogController } from './controllers/storefront-catalog.controller';
import { StorefrontContentController } from './controllers/storefront-content.controller';
import { StorefrontCatalogService } from './providers/storefront-catalog.service';
import { StorefrontContentService } from './providers/storefront-content.service';

/**
 * La tienda que ve la visitante: la superficie `/public/:storeSlug/*`.
 *
 * Vive aparte del catálogo del panel aunque lea las mismas tablas, y es
 * deliberado (ARCHITECTURE.md § 3): con DTOs propios, agregar un campo interno
 * a una respuesta del panel no puede terminar sirviéndoselo a la visitante.
 */
@Module({
  controllers: [StorefrontContentController, StorefrontCatalogController],
  providers: [PublicStoreResolver, StorefrontCatalogService, StorefrontContentService],
})
export class StorefrontModule {}
