import { Env } from '@shared/config/env';

import { AnthropicAssistant } from './anthropic-assistant';
import { Assistant } from './assistant';
import { NullAssistant } from './null-assistant';

type AiEnv = Pick<Env, 'AI_DRIVER' | 'ANTHROPIC_API_KEY' | 'AI_MODEL' | 'AI_MAX_OUTPUT_TOKENS'>;

/**
 * El asistente que pide el entorno. Apagado por defecto: encenderlo cuesta
 * dinero por conversación, y eso no puede pasar por descuido.
 */
export function createAssistant(env: AiEnv): Assistant {
  if (env.AI_DRIVER !== 'anthropic') return new NullAssistant();

  // La validación del entorno ya exigió la clave con este driver.
  return new AnthropicAssistant({
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    model: env.AI_MODEL,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
  });
}
