import Anthropic from '@anthropic-ai/sdk';

import { Assistant, AssistantAnswer, AssistantRequest } from './assistant';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
}

/**
 * Cuántas veces se le deja pedir herramientas antes de obligarlo a responder.
 *
 * Dos alcanzan para «busca la prenda y mira el envío». Más rondas es más
 * dinero por conversación sin mejor respuesta: si con dos consultas no supo,
 * lo que corresponde es pasar la conversación a WhatsApp.
 */
const MAX_RONDAS = 2;

/**
 * El asistente contra la API de Anthropic.
 *
 * Usa herramientas en vez de meter el catálogo en el instructivo: es más
 * barato —solo viaja lo que hizo falta— y es lo que evita que hable de
 * prendas que no existen.
 *
 * El instructivo va marcado para caché: es el bloque que se repite en cada
 * mensaje de la conversación, y es donde está el ahorro.
 */
export class AnthropicAssistant extends Assistant {
  readonly available = true;

  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    super();
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async answer(request: AssistantRequest): Promise<AssistantAnswer> {
    const mensajes: Anthropic.MessageParam[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const tools: Anthropic.Tool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input as Anthropic.Tool.InputSchema,
    }));

    let inputTokens = 0;
    let outputTokens = 0;

    for (let ronda = 0; ronda <= MAX_RONDAS; ronda += 1) {
      const response = await this.client.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxOutputTokens,
        system: [
          {
            type: 'text',
            text: request.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        // En la última ronda ya no se le ofrecen herramientas: que responda con
        // lo que tiene.
        tools: ronda < MAX_RONDAS ? tools : [],
        messages: mensajes,
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const llamadas = response.content.filter(
        (bloque): bloque is Anthropic.ToolUseBlock => bloque.type === 'tool_use',
      );

      if (llamadas.length === 0) {
        return { text: textOf(response), usage: { inputTokens, outputTokens } };
      }

      mensajes.push({ role: 'assistant', content: response.content });
      mensajes.push({
        role: 'user',
        content: await Promise.all(
          llamadas.map(async (llamada) => ({
            type: 'tool_result' as const,
            tool_use_id: llamada.id,
            content: JSON.stringify(await request.run(llamada.name, llamada.input)),
          })),
        ),
      });
    }

    // Se agotaron las rondas sin una respuesta de texto.
    return { text: '', usage: { inputTokens, outputTokens } };
  }
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('\n')
    .trim();
}
