import { Module } from '@nestjs/common';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { AssistantController } from './controllers/assistant.controller';
import { AssistantService } from './providers/assistant.service';

/**
 * El asistente de la tienda. Vive aparte de `storefront` porque es lo único de
 * la superficie pública que cuesta dinero por petición y que puede estar
 * apagado: mezclarlo con el catálogo haría que una decisión de producto —lo
 * incluye el plan o no— se repartiera por todo un módulo.
 */
@Module({
  controllers: [AssistantController],
  providers: [PublicStoreResolver, AssistantService],
})
export class AssistantModule {}
