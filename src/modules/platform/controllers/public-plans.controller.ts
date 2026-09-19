import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PlanDto } from '@shared/dtos/platform/platform.dto';

import { PlatformService } from '../providers/platform.service';

/**
 * Los planes, para el sitio comercial.
 *
 * Sin sesión: la página de precios la ve cualquiera. Va aparte de
 * `/platform/plans` —que sí exige ser administrador— porque son dos públicos
 * distintos y mezclarlos en una ruta es como termina filtrándose algo.
 *
 * Cuelga de `/plans` y no de `/public/plans` porque ahí ya vive
 * `/public/:storeSlug`: una tienda llamada «plans» y esta ruta competirían, y
 * cuál gana dependería del orden en que se registran los módulos.
 *
 * Solo devuelve los planes que se ofrecen hoy: uno retirado sigue existiendo
 * para las tiendas que lo tienen, pero no se anuncia.
 */
@ApiTags('plataforma')
@SkipThrottle()
@Controller('plans')
export class PublicPlansController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'Planes que se ofrecen, con sus precios y límites.' })
  async list(): Promise<PlanDto[]> {
    const plans = await this.platform.listPlans();

    return plans.filter((plan) => plan.active);
  }
}
