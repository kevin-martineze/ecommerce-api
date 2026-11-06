import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { DomainProvider } from './domain-provider';
import { LogDomainProvider } from './log-domain-provider';

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
        const driver = config.get('DOMAINS_DRIVER', { infer: true });

        if (driver === 'vercel') {
          // Llega en B2; hasta entonces no se finge que funciona.
          throw new Error('DOMAINS_DRIVER=vercel todavía no está implementado.');
        }

        return new LogDomainProvider();
      },
    },
  ],
  exports: [DomainProvider],
})
export class DomainProviderModule {}
