import { Module } from '@nestjs/common';

import { CommerceController } from './controllers/commerce.controller';
import { CouponsService } from './providers/coupons.service';
import { RestockRequestsService } from './providers/restock-requests.service';
import { ShippingZonesService } from './providers/shipping-zones.service';

/**
 * Comercio en el panel: cupones, zonas de envío y avisos de reposición.
 *
 * Cómo se APLICAN cupones y envíos al vender está en el módulo de pedidos y en
 * `shared/commerce/pricing.ts`; acá solo se administran.
 */
@Module({
  controllers: [CommerceController],
  providers: [CouponsService, ShippingZonesService, RestockRequestsService],
})
export class CommerceModule {}
