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
