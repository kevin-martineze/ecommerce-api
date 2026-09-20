import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AskAssistantDto, AssistantReplyDto } from '@shared/dtos/storefront/assistant.dto';

import { AssistantService } from '../providers/assistant.service';

@ApiTags('tienda pública')
@Controller('public/:storeSlug/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * A diferencia del resto de la tienda pública, esta ruta SÍ lleva límite por
   * IP: cada llamada cuesta dinero, y el tope del plan protege a la tienda,
   * no al servidor. Diez por minuto es una conversación rápida; cien es un
   * script.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Responde una pregunta de la clienta con el catálogo de la tienda.' })
  ask(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: AskAssistantDto,
  ): Promise<AssistantReplyDto> {
    return this.assistant.ask(storeSlug, dto);
  }
}
