import { invitationMail, passwordResetMail } from './templates';

describe('plantillas de correo', () => {
  it('escapa lo que escribió una persona antes de meterlo en el HTML', () => {
    const mail = invitationMail(
      'ayudante@tienda.test',
      'https://tienda.test/admin/invitacion?token=a.b',
      '<script>alert(1)</script> & "Cía"',
      null,
      7,
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Cía&quot;');
    expect(mail.subject).toBe('Te invitaron a <script>alert(1)</script> & "Cía"');
  });

  it('lleva el enlace en el texto plano y en el HTML', () => {
    const url = 'https://tienda.test/admin/restablecer?token=abc';
    const mail = passwordResetMail('duena@tienda.test', url, 60);

    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.text).toContain('60 minutos');
  });
});
