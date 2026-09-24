import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingSetupDto } from '@shared/dtos/platform/platform.dto';

import { SubscriptionsService } from '../providers/subscriptions.service';

/**
 * Lo que el navegador necesita para guardar una tarjeta, sin sesión.
 *
 * Sin sesión porque se pide mientras se está creando la tienda, cuando
 * todavía no hay ninguna. Lo que devuelve es público por definición: la llave
 * pública de la pasarela y sus términos. Con eso el navegador convierte la
 * tarjeta en un token y nos manda el token, nunca la tarjeta.
 *
 * Cuelga de `/billing` y no de `/public/billing` por lo mismo que `/plans`:
 * ahí vive `/public/:storeSlug` y una tienda llamada «billing» competiría con
 * esta ruta.
 */
@ApiTags('plataforma')
@Controller('billing')
export class PublicBillingController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('setup')
  @ApiOperation({ summary: 'Llave pública y términos de la pasarela, para tokenizar una tarjeta.' })
  setup(): Promise<BillingSetupDto> {
    return this.subscriptions.billingSetup();
  }
}
