import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { LogMailer } from './log-mailer';
import { Mailer } from './mailer';
import { SmtpMailer } from './smtp-mailer';

/** Global como el almacenamiento: el correo lo usan cuenta y equipo, y el driver lo decide el entorno. */
@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Mailer => {
        const smtpUrl = config.get('SMTP_URL', { infer: true });

        // La validación del entorno exige SMTP_URL con el driver smtp.
        if (config.get('MAIL_DRIVER', { infer: true }) === 'smtp' && smtpUrl) {
          return new SmtpMailer(smtpUrl, config.get('MAIL_FROM', { infer: true }));
        }

        return new LogMailer();
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
