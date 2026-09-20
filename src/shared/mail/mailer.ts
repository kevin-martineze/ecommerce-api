export interface MailMessage {
  to: string;
  subject: string;
  /** Texto plano. Es lo que lee un cliente de correo sin HTML y lo que se loguea. */
  text: string;
  html: string;
}

/**
 * Correo saliente.
 *
 * Clase abstracta para usarla como token de inyección, igual que
 * `MediaStorage`: los servicios piden `Mailer` y el entorno decide si detrás
 * hay un log o un SMTP.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
