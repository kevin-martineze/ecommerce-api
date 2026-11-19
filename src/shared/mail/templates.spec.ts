import {
  googleLinkedMail,
  googleUnlinkedMail,
  invitationMail,
  passwordCreatedMail,
  passwordResetMail,
} from './templates';

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

  it('el aviso de Google vinculado dice si se borró la contraseña', () => {
    const url = 'https://tienda.test/admin/forgot-password';
    const withRemoval = googleLinkedMail('duena@tienda.test', url, true);
    const withoutRemoval = googleLinkedMail('duena@tienda.test', url, false);

    expect(withRemoval.text).toContain('borramos la contraseña');
    expect(withoutRemoval.text).not.toContain('borramos la contraseña');
    expect(withRemoval.html).toContain(`href="${url}"`);
  });

  it('los avisos de contraseña creada y de Google desconectado llevan asunto propio y el enlace', () => {
    const url = 'https://tienda.test/admin/forgot-password';
    const created = passwordCreatedMail('duena@tienda.test', url);
    const unlinked = googleUnlinkedMail('duena@tienda.test', url);

    expect(created.subject).toBe('Se creó una contraseña para tu cuenta');
    expect(unlinked.subject).toBe('Se desconectó Google de tu cuenta');

    for (const mail of [created, unlinked]) {
      expect(mail.to).toBe('duena@tienda.test');
      expect(mail.text).toContain(url);
      expect(mail.html).toContain(`href="${url}"`);
    }
  });
});
