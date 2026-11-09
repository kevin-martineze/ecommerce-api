import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { DomainProvider } from './domain-provider';
import { LogDomainProvider } from './log-domain-provider';
import { VercelDomainProvider } from './vercel-domain-provider';

/**
 * El proveedor de dominios, global como el correo: lo usa el módulo de dominios
 * y, en B4, el chequeo diario. El driver lo decide `DOMAINS_DRIVER`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DomainProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DomainProvider => {
        if (config.get('DOMAINS_DRIVER', { infer: true }) === 'vercel') {
          // La validación del entorno exige el token y el proyecto con este driver.
          return new VercelDomainProvider({
            token: config.get('VERCEL_API_TOKEN', { infer: true }) ?? '',
            projectId: config.get('VERCEL_PROJECT_ID', { infer: true }) ?? '',
            teamId: config.get('VERCEL_TEAM_ID', { infer: true }),
          });
        }

        return new LogDomainProvider();
      },
    },
  ],
  exports: [DomainProvider],
})
export class DomainProviderModule {}
