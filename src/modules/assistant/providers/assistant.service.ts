import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Assistant, AssistantMessage } from '@shared/ai/assistant';
import { AskAssistantDto, AssistantReplyDto } from '@shared/dtos/storefront/assistant.dto';
import { startOfMonthInBogota } from '@shared/utils/bogota-time';
import { PrismaService } from '@db/prisma.service';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { runStoreTool, STORE_TOOLS } from './store-tools';

/**
 * El asistente de una tienda, respondiéndole a sus clientas.
 *
 * Tres cosas pasan antes de gastar un peso: que la plataforma tenga un modelo
 * encendido, que el plan de la tienda incluya asistente y que le queden
 * respuestas del mes. El tope es mensual y por tienda porque el costo lo pone
 * el tráfico de la tienda, no lo que paga la dueña.
 *
 * Lo que responde sale de las herramientas —el catálogo y los envíos de ESA
 * tienda, dentro de `forStore`—, nunca de lo que el modelo crea recordar.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: PublicStoreResolver,
    private readonly assistant: Assistant,
  ) {}

  async ask(storeSlug: string, dto: AskAssistantDto): Promise<AssistantReplyDto> {
    if (!this.assistant.available) {
      throw new ServiceUnavailableException({
        message: 'El asistente no está disponible.',
        error: 'ai_disabled',
      });
    }

    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { storeId: store.id },
        include: { plan: true },
      });

      const cuota = subscription?.plan.aiRepliesPerMonth ?? 0;

      if (cuota <= 0) {
        throw new ForbiddenException({
          message: 'Esta tienda no tiene asistente.',
          error: 'ai_disabled',
        });
      }

      const usadas = await tx.aiReply.count({
        where: { storeId: store.id, createdAt: { gte: startOfMonthInBogota(new Date()) } },
      });

      if (usadas >= cuota) {
        // Se acabó la cuota: no se corta la conversación, se pasa a WhatsApp.
        // Quien está preguntando es una clienta, y no tiene por qué pagar el
        // plan de la tienda con un «vuelve el mes que viene».
        throw new ForbiddenException({
          message: 'El asistente de esta tienda alcanzó su límite del mes.',
          error: 'plan_limit',
          details: { limit: 'aiRepliesPerMonth', max: cuota },
        });
      }

      const answer = await this.assistant.answer({
        system: systemPrompt(store.name),
        messages: dto.messages.map((message): AssistantMessage => ({
          role: message.role,
          content: message.content,
        })),
        tools: STORE_TOOLS,
        run: (name, input) => runStoreTool({ tx, storeId: store.id }, name, input),
      });

      await tx.aiReply.create({
        data: {
          storeId: store.id,
          inputTokens: answer.usage.inputTokens,
          outputTokens: answer.usage.outputTokens,
        },
      });

      const texto = answer.text.trim();

      if (!texto) {
        this.logger.warn(`El asistente de ${store.slug} no devolvió texto.`);
      }

      return {
        reply: texto || SIN_RESPUESTA,
        // Sin texto, o cuando el propio modelo remite al chat: el botón de
        // WhatsApp tiene que estar ahí, no escondido.
        handoff: !texto || /whatsapp/i.test(texto),
        remaining: Math.max(0, cuota - usadas - 1),
      };
    });
  }
}

const SIN_RESPUESTA =
  'No estoy seguro de eso. Escríbenos por WhatsApp y te responde alguien del equipo.';

/**
 * Lo que el asistente puede y no puede hacer.
 *
 * Las prohibiciones son la parte importante: un asistente de tienda que
 * improvisa un precio o promete un envío que no existe le crea un problema a
 * la dueña, no al modelo. Va marcado para caché en el driver porque es el
 * bloque que se repite en cada mensaje de la conversación.
 */
function systemPrompt(storeName: string): string {
  return [
    `Eres quien atiende el chat de ${storeName}, una tienda de ropa en Colombia.`,
    'Hablas como una vendedora amable y directa: tuteas, vas al grano y respondes en dos o tres frases.',
    '',
    'Reglas que no se rompen:',
    '- Solo afirmas lo que devolvieron las herramientas. Precios, tallas, colores, costos y tiempos de envío se consultan SIEMPRE; nunca se recuerdan ni se suponen.',
    '- Si la herramienta no encontró algo, lo dices con naturalidad y ofreces seguir por WhatsApp. No inventas alternativas que no viste.',
    '- No prometes descuentos, apartados, cambios ni fechas de entrega: eso lo decide la tienda por WhatsApp.',
    '- No pides datos personales, ni de tarjetas: en esta tienda el pedido se cierra por WhatsApp.',
    '- No hablas de otras tiendas ni te comparas con nadie.',
    '- Los precios van en pesos colombianos, con punto de miles.',
    '',
    'Si la clienta quiere comprar, dile que agregue la prenda al carrito y que desde ahí el pedido llega por WhatsApp.',
  ].join('\n');
}
