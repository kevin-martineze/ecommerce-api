import { MailMessage } from './mailer';

/**
 * Los correos que manda la plataforma.
 *
 * HTML mínimo y en línea: los clientes de correo ignoran hojas de estilo y
 * la mitad de las propiedades. Todo valor que venga de una persona (nombre de
 * tienda, de quien invita) se escapa.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(
  title: string,
  paragraphs: string[],
  action: { label: string; url: string },
): string {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px">${escapeHtml(text)}</p>`)
    .join('');

  return `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="margin:0;font-size:13px;color:#555">Si el botón no funciona, copia este enlace:<br>${escapeHtml(action.url)}</p>
</body></html>`;
}

/** Al equipo: una tienda abrió un caso o escribió en uno. Sin el texto: el enlace lleva a la conversación. */
export function supportOwnerWroteMail(
  to: string,
  storeName: string,
  subject: string,
  url: string,
  isNew: boolean,
): MailMessage {
  const title = isNew ? `Caso nuevo de ${storeName}` : `Nueva respuesta de ${storeName}`;
  const lines = [
    isNew
      ? `${storeName} abrió un caso de soporte: «${subject}».`
      : `${storeName} escribió en el caso «${subject}».`,
    'Abre el caso para leer el mensaje completo y responder.',
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Abrir el caso', url }),
  };
}

/** A la dueña: el equipo le respondió su caso. */
export function supportTeamRepliedMail(to: string, subject: string, url: string): MailMessage {
  const title = 'Te respondimos en Globerce';
  const lines = [
    `Respondimos tu caso «${subject}». Entra a tu panel para leer la respuesta.`,
    'Si ya quedó resuelto, no hace falta que respondas.',
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Leer la respuesta', url }),
  };
}

export function passwordResetMail(to: string, url: string, minutes: number): MailMessage {
  const title = 'Restablece tu contraseña';
  const lines = [
    'Alguien pidió restablecer la contraseña de tu cuenta. Si fuiste tú, usa el enlace de abajo.',
    `El enlace sirve una sola vez y vence en ${minutes} minutos. Si no lo pediste, ignora este correo: tu contraseña no cambia.`,
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Elegir contraseña nueva', url }),
  };
}

export function invitationMail(
  to: string,
  url: string,
  storeName: string,
  invitedBy: string | null,
  days: number,
): MailMessage {
  const title = `Te invitaron a ${storeName}`;
  const who = invitedBy ? `${invitedBy} te invitó` : 'Te invitaron';
  const lines = [
    `${who} a ayudar a administrar ${storeName}.`,
    `La invitación vence en ${days} días.`,
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Aceptar la invitación', url }),
  };
}

/**
 * A la dueña: se conectó Google a su cuenta.
 *
 * Sale en cada vínculo, aunque lo haya hecho ella: si no fue, es la única
 * forma de enterarse. Con `passwordRemoved`, además le cuenta que la
 * contraseña se borró (la cuenta nunca había probado su correo) y cómo
 * volver a tener una.
 */
export function googleLinkedMail(to: string, url: string, passwordRemoved: boolean): MailMessage {
  const title = 'Se conectó Google a tu cuenta';
  const lines = [
    `Desde ahora puedes entrar a Globerce con tu cuenta de Google (${to}).`,
    ...(passwordRemoved
      ? [
          'Por seguridad borramos la contraseña que tenía la cuenta y cerramos todas las sesiones abiertas. Si quieres seguir entrando con contraseña, crea una nueva con el enlace de abajo.',
        ]
      : ['Por seguridad cerramos las demás sesiones abiertas.']),
    'Si no fuiste tú, crea una contraseña nueva con el enlace de abajo y escríbenos.',
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Crear una contraseña', url }),
  };
}

/**
 * A la dueña: se creó una contraseña para una cuenta que entraba solo con Google.
 *
 * El enlace lleva a recuperar contraseña: si no fue ella, así cambia la
 * contraseña que acaba de crear alguien más.
 */
export function passwordCreatedMail(to: string, url: string): MailMessage {
  const title = 'Se creó una contraseña para tu cuenta';
  const lines = [
    `Se creó una contraseña para tu cuenta de Globerce (${to}). Desde ahora puedes entrar con tu correo y esa contraseña, además de con Google.`,
    'Por seguridad cerramos las demás sesiones abiertas.',
    'Si no fuiste tú, cambia la contraseña con el enlace de abajo y escríbenos.',
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Cambiar la contraseña', url }),
  };
}

/**
 * A la dueña: se desconectó Google de su cuenta.
 *
 * Sale siempre, aunque lo haya hecho ella: si no fue, es la única forma de
 * enterarse. El enlace lleva a recuperar contraseña por el mismo motivo.
 */
export function googleUnlinkedMail(to: string, url: string): MailMessage {
  const title = 'Se desconectó Google de tu cuenta';
  const lines = [
    `Desconectaste Google de tu cuenta de Globerce (${to}). Desde ahora entras con tu correo y tu contraseña.`,
    'Por seguridad cerramos las demás sesiones abiertas.',
    'Si no fuiste tú, cambia la contraseña con el enlace de abajo y escríbenos.',
  ];

  return {
    to,
    subject: title,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: layout(title, lines, { label: 'Cambiar la contraseña', url }),
  };
}
