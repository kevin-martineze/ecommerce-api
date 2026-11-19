import { randomBytes } from 'node:crypto';

import { FakeGoogle, FakeGoogleAccount, newCodeVerifier } from './utils/fake-google';
import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Entrar y registrarse con Google, contra la base de verdad y un Google de
 * mentira que firma sus propios `id_token` (ver `FakeGoogle`).
 *
 * `/auth/google` está limitado a 10 por minuto y `/auth/google/register` a 5:
 * los rechazos de Google van en `auth-google-errors.e2e-spec.ts`, con su
 * propio contador.
 */

jest.setTimeout(60_000);

const REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  activeStoreId: string | null;
  user: { id: string; email: string; fullName: string | null };
  stores: { id: string; role: string }[];
}

type GoogleBody =
  | { status: 'session'; session: SessionBody }
  | { status: 'signup_required'; signupToken: string; email: string; fullName: string | null };

interface ErrorBody {
  message: string;
  error: string;
}

describe('Entrar con Google (e2e)', () => {
  const google = new FakeGoogle();
  let api: TestApp;

  /** Lo que haría el callback del frontend: elegir la cuenta en Google y canjear el código. */
  const signIn = (account: FakeGoogleAccount) => {
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(account, codeVerifier, REDIRECT_URI);

    return api.call<GoogleBody>('POST', '/auth/google', undefined, {
      code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
    });
  };

  const newSub = () => `${Date.now()}${randomBytes(4).readUInt32BE()}`;

  const userRow = async (email: string) => {
    const { rows } = await api.withOwner((client) =>
      client.query<{
        password_hash: string | null;
        email_verified_at: Date | null;
        identities: number;
      }>(
        `select u.password_hash, u.email_verified_at,
                (select count(*)::int from user_identities i where i.user_id = u.id) as identities
           from users u where u.email = $1`,
        [email],
      ),
    );

    return rows[0];
  };

  const sessionOf = (body: GoogleBody): SessionBody => {
    if (body.status !== 'session') {
      throw new Error(`Se esperaba una sesión y llegó ${body.status}.`);
    }

    return body.session;
  };

  beforeAll(async () => {
    api = await startTestApp({ googleFetch: google.fetch });
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('registro con Google', () => {
    let account: FakeGoogleAccount;
    let signupToken: string;

    beforeAll(() => {
      account = { sub: newSub(), email: api.email('google-nueva'), name: 'María Google' };
    });

    it('sin cuenta, pide el segundo paso con el correo y el nombre de Google', async () => {
      const { status, body } = await signIn({ ...account, email: account.email.toUpperCase() });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'signup_required',
        email: account.email,
        fullName: 'María Google',
      });

      if (body.status === 'signup_required') {
        signupToken = body.signupToken;
      }
    });

    it('el signupToken no abre sesión como si fuera un access token', async () => {
      expect((await api.call('GET', '/auth/me', { token: signupToken })).status).toBe(401);
    });

    it('crea la tienda y la cuenta sin contraseña, con el correo probado', async () => {
      const slug = `e2e-google-${newSub()}`;
      const { status, body } = await api.call<SessionBody>(
        'POST',
        '/auth/google/register',
        undefined,
        { signupToken, storeName: 'Tienda Google', storeSlug: slug, whatsappPhone: '573001234567' },
      );

      expect(status).toBe(201);
      expect(body.user).toMatchObject({ email: account.email, fullName: 'María Google' });
      expect(body.stores).toEqual([expect.objectContaining({ role: 'OWNER' })]);

      if (body.activeStoreId) {
        api.forgetStore(body.activeStoreId);
      }

      const row = await userRow(account.email);

      expect(row).toMatchObject({ password_hash: null, identities: 1 });
      expect(row?.email_verified_at).not.toBeNull();
      expect((await api.call('GET', '/auth/me', { token: body.accessToken })).status).toBe(200);
    });

    it('el mismo signupToken no registra dos veces', async () => {
      const { status, body } = await api.call<ErrorBody>(
        'POST',
        '/auth/google/register',
        undefined,
        {
          signupToken,
          storeName: 'Otra',
          storeSlug: `e2e-google-${newSub()}`,
          whatsappPhone: '573001234567',
        },
      );

      expect(status).toBe(409);
      expect(body.error).toBe('email_taken');
    });

    it('la próxima vez entra directo, por el sub de Google', async () => {
      const { status, body } = await signIn(account);

      expect(status).toBe(200);
      expect(sessionOf(body).user.email).toBe(account.email);
    });

    it('con contraseña responde use_google', async () => {
      const { status, body } = await api.call<ErrorBody>('POST', '/auth/login', undefined, {
        email: account.email,
        password: TEST_PASSWORD,
      });

      expect(status).toBe(401);
      expect(body).toMatchObject({ error: 'use_google', message: 'Esta cuenta entra con Google.' });
    });
  });

  describe('vínculo con una cuenta que ya existe', () => {
    it('si la cuenta nunca probó su correo, se borra la contraseña y se cierran sus sesiones', async () => {
      const owner = await api.register('google-sin-probar');

      const { status, body } = await signIn({ sub: newSub(), email: owner.email });

      expect(status).toBe(200);
      expect(sessionOf(body).activeStoreId).toBe(owner.storeId);

      const row = await userRow(owner.email);

      expect(row).toMatchObject({ password_hash: null, identities: 1 });
      expect(row?.email_verified_at).not.toBeNull();

      const oldSession = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: owner.refreshToken,
      });

      expect(oldSession.status).toBe(401);
      expect(api.lastMailTo(owner.email)).toContain('borramos la contraseña');
      expect(api.lastMailTo(owner.email)).toContain('/admin/forgot-password');
    });

    it('si la cuenta ya probó su correo, conserva la contraseña', async () => {
      const owner = await api.register('google-probada');

      await api.withOwner((client) =>
        client.query('update users set email_verified_at = now() where email = $1', [owner.email]),
      );

      const { status } = await signIn({ sub: newSub(), email: owner.email });

      expect(status).toBe(200);
      expect(api.lastMailTo(owner.email)).toContain(
        'Desde ahora puedes entrar a Globerce con tu cuenta de Google',
      );
      expect(api.lastMailTo(owner.email)).not.toContain('borramos la contraseña');

      const login = await api.call('POST', '/auth/login', undefined, {
        email: owner.email,
        password: TEST_PASSWORD,
      });

      expect(login.status).toBe(200);
    });

    it('entra aunque la cuenta esté bloqueada por intentos fallidos', async () => {
      const owner: Session = await api.register('google-bloqueada');

      await api.withOwner((client) =>
        client.query(
          `update users set locked_until = now() + interval '15 minutes' where email = $1`,
          [owner.email],
        ),
      );

      const { status } = await signIn({ sub: newSub(), email: owner.email });

      expect(status).toBe(200);
    });
  });

  describe('el correo queda probado', () => {
    /** Saca el valor de `token=` del enlace que llegó en el correo. */
    const tokenFrom = (mail: string | null): string => {
      const match = /token=([^\s]+)/.exec(mail ?? '');

      if (!match?.[1]) {
        throw new Error('El correo no trae un enlace con token.');
      }

      return match[1];
    };

    it('al restablecer la contraseña', async () => {
      const owner = await api.register('google-reset');

      expect((await userRow(owner.email))?.email_verified_at).toBeNull();

      await api.call('POST', '/auth/password/forgot', undefined, { email: owner.email });

      const reset = await api.call('POST', '/auth/password/reset', undefined, {
        token: tokenFrom(api.lastMailTo(owner.email)),
        password: 'otra contraseña larga de prueba',
      });

      expect(reset.status).toBe(204);
      expect((await userRow(owner.email))?.email_verified_at).not.toBeNull();
    });

    it('al aceptar una invitación', async () => {
      const owner = await api.register('google-invita');
      const invitee = api.email('google-invitada');

      const invited = await api.call('POST', `/stores/${owner.storeId}/invitations`, owner, {
        email: invitee,
        role: 'STAFF',
      });

      expect(invited.status).toBe(201);

      const accepted = await api.call('POST', '/auth/invitations/accept', undefined, {
        token: tokenFrom(api.lastMailTo(invitee)),
        password: TEST_PASSWORD,
        fullName: 'Ayudante',
      });

      expect(accepted.status).toBe(200);
      expect((await userRow(invitee))?.email_verified_at).not.toBeNull();
    });
  });
});
