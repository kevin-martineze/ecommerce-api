import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';
import { Mailer, MailMessage } from '@shared/mail/mailer';
import { supportOwnerWroteMail, supportTeamRepliedMail } from '@shared/mail/templates';

/**
 * Correos del centro de soporte.
 *
 * Ninguno lleva el texto del mensaje: el correo avisa y el enlace lleva a la
 * conversación, que está dentro de la sesión. Así un correo reenviado o
 * guardado en otra bandeja no lleva consigo lo que escribió la dueña.
 *
 * Un fallo de correo nunca tumba la petición: el mensaje ya quedó guardado y
 * la persona lo ve al entrar. Se registra solo el id del caso.
 */
@Injectable()
export class SupportNotifier {
  private readonly logger = new Logger(SupportNotifier.name);

  constructor(
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Al equipo: la dueña abrió un caso nuevo o escribió en uno. */
  async ownerWrote(input: {
    ticketId: string;
    storeId: string;
    storeName: string;
    subject: string;
    isNew: boolean;
  }): Promise<void> {
    const to = this.config.get('SUPPORT_TEAM_EMAIL', { infer: true });

    if (!to) {
      this.logger.warn(`Sin SUPPORT_TEAM_EMAIL: el caso ${input.ticketId} no avisó al equipo.`);

      return;
    }

    const url = `${this.frontendUrl()}/plataforma/soporte/${input.storeId}/${input.ticketId}`;

    await this.send(
      input.ticketId,
      supportOwnerWroteMail(to, input.storeName, input.subject, url, input.isNew),
    );
  }

  /** A la dueña: el equipo le respondió. */
  async teamReplied(input: { ticketId: string; to: string; subject: string }): Promise<void> {
    const url = `${this.frontendUrl()}/admin/soporte/${input.ticketId}`;

    await this.send(input.ticketId, supportTeamRepliedMail(input.to, input.subject, url));
  }

  private frontendUrl(): string {
    return this.config.get('FRONTEND_URL', { infer: true });
  }

  private async send(ticketId: string, message: MailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.name : 'desconocido';

      this.logger.warn(`No se pudo enviar el aviso del caso ${ticketId} (${reason}).`);
    }
  }
}
