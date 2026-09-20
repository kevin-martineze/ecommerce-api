import { Logger } from '@nestjs/common';

import { Mailer, MailMessage } from './mailer';

/** Cuántos mensajes recuerda. Solo lo leen los tests; no crece sin techo en desarrollo. */
const OUTBOX_LIMIT = 50;

/**
 * Correo de desarrollo: no sale a ningún lado.
 *
 * Escribe el texto en el log —el enlace de recuperar contraseña se copia de
 * ahí— y guarda los últimos mensajes en memoria para que los e2e lean el
 * enlace sin un SMTP de por medio.
 */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly outbox: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);

    if (this.outbox.length > OUTBOX_LIMIT) {
      this.outbox.shift();
    }

    this.logger.log(`Para ${message.to} — ${message.subject}\n${message.text}`);

    return Promise.resolve();
  }

  /** El último mensaje enviado a ese correo, o null. */
  lastTo(email: string): MailMessage | null {
    return this.outbox.findLast((message) => message.to === email) ?? null;
  }
}
