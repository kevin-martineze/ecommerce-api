import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { Assistant } from './assistant';
import { createAssistant } from './create-assistant';

/** Global, como el almacenamiento: qué modelo hay detrás lo decide el entorno. */
@Global()
@Module({
  providers: [
    {
      provide: Assistant,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Assistant =>
        createAssistant({
          AI_DRIVER: config.get('AI_DRIVER', { infer: true }),
          ANTHROPIC_API_KEY: config.get('ANTHROPIC_API_KEY', { infer: true }),
          AI_MODEL: config.get('AI_MODEL', { infer: true }),
          AI_MAX_OUTPUT_TOKENS: config.get('AI_MAX_OUTPUT_TOKENS', { infer: true }),
        }),
    },
  ],
  exports: [Assistant],
})
export class AiModule {}
