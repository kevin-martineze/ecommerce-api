import { randomBytes } from 'node:crypto';

import { FakeGoogle, FakeGoogleAccount, newCodeVerifier } from './utils/fake-google';
import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Aceptar una invitación entrando con Google, contra la base de verdad y un
 * Google de mentira (ver `FakeGoogle`).
 *
 * `/auth/invitations/accept-google` está limitado a 10 por minuto y
 * `/auth/google` a 10 también: cada suite tiene su propio contador, y esta
 * suite hace menos de diez canjes de cada uno.
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

interface ErrorBody {
  message: string;
  error?: string;
}

/** Saca el valor de `token=` del enlace que llegó en el correo. */
const tokenFrom = (mail: string | null): string => {
  const match = /token=([^\s]+)/.exec(mail ?? '');

  if (!match?.[1]) {
    throw new Error('El correo no trae un enlace con token.');
  }

  return match[1];
};

describe('Aceptar una invitación con Google (e2e)', () => {
  const google = new FakeGoogle();
  let api: TestApp;
  let owner: Session;

  const newSub = () => `${Date.now()}${randomBytes(4).readUInt32BE()}`;

  /** Lo que haría el callback del frontend: elegir la cuenta en Google y canjear el código. */
  const acceptWith = (token: string, account: FakeGoogleAccount) => {
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(account, codeVerifier, REDIRECT_URI);

    return api.call<SessionBody & ErrorBody>('POST', '/auth/invitations/accept-google', undefined, {
      token,
      code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
    });
  };

  /** Entrar con Google sin invitación: crea o vincula la cuenta, como en `auth-google`. */
  const signInWith = (account: FakeGoogleAccount) => {
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(account, codeVerifier, REDIRECT_URI);

    return api.call('POST', '/auth/google', undefined, {
      code,
      codeVerifier,
      redirectUri: REDIRECT_URI,
    });
  };

  /** La dueña invita a ese correo y devuelve el enlace que llegó por correo. */
  const invite = async (email: string): Promise<string> => {
    const invited = await api.call('POST', `/stores/${owner.storeId}/invitations`, owner, {
      email,
      role: 'STAFF',
    });

    expect(invited.status).toBe(201);

    return tokenFrom(api.lastMailTo(email));
  };

  const userRow = async (email: string) => {
    const { rows } = await api.withOwner((client) =>
      client.query<{
        id: string;
        password_hash: string | null;
        email_verified_at: Date | null;
        identities: number;
      }>(
        `select u.id, u.password_hash, u.email_verified_at,
                (select count(*)::int from user_identities i where i.user_id = u.id) as identities
           from users u where u.email = $1`,
        [email],
      ),
    );

    return rows[0];
  };

  const invitationRow = async (email: string) => {
    const { rows } = await api.withOwner((client) =>
      client.query<{ accepted_at: Date | null }>(
        'select accepted_at from store_invitations where store_id = $1 and email = $2',
        [owner.storeId, email],
      ),
    );

    return rows[0];
  };

  const roleIn = async (email: string, storeId: string): Promise<string | undefined> => {
    const { rows } = await api.withOwner((client) =>
      client.query<{ role: string }>(
        `select m.role from store_members m join users u on u.id = m.user_id
          where u.email = $1 and m.store_id = $2`,
        [email, storeId],
      ),
    );

    return rows[0]?.role;
  };

  beforeAll(async () => {
    api = await startTestApp({ googleFetch: google.fetch });
    owner = await api.register('inv-google-duena');
  });

  afterAll(async () => {
    await api?.close();
  });

  it('sin cuenta, crea el usuario sin contraseña con el correo probado y la membresía con el rol invitado', async () => {
    const invitee = api.email('inv-google-nueva');
    const token = await invite(invitee);

    const { status, body } = await acceptWith(token, {
      sub: newSub(),
      email: invitee,
      name: 'Ayudante Google',
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      activeStoreId: owner.storeId,
      user: { email: invitee, fullName: 'Ayudante Google' },
    });
    expect(body.stores).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: owner.storeId, role: 'STAFF' })]),
    );

    const row = await userRow(invitee);

    expect(row).toMatchObject({ password_hash: null, identities: 1 });
    expect(row?.email_verified_at).not.toBeNull();
    expect(await roleIn(invitee, owner.storeId)).toBe('STAFF');
    expect((await invitationRow(invitee))?.accepted_at).not.toBeNull();
    expect((await api.call('GET', '/auth/me', { token: body.accessToken })).status).toBe(200);
  });

  it('el mismo enlace, con otro código, ya no sirve: 400 con el mensaje de siempre', async () => {
    const invitee = api.email('inv-google-nueva');
    const token = tokenFrom(api.lastMailTo(invitee));

    const { status, body } = await acceptWith(token, { sub: newSub(), email: invitee });

    expect(status).toBe(400);
    expect(body.message).toBe('La invitación no es válida, ya se usó o venció.');
  });

  it('un correo de Google distinto al invitado responde 403 y no toca la invitación', async () => {
    const invitee = api.email('inv-google-otro');
    const other = api.email('inv-google-otra-cuenta');
    const token = await invite(invitee);

    const mismatch = await acceptWith(token, { sub: newSub(), email: other });

    expect(mismatch.status).toBe(403);
    expect(mismatch.body).toMatchObject({
      message: `Esta invitación es para otro correo. Entra a Google con ${invitee}.`,
      error: 'invitation_email_mismatch',
    });
    expect(await userRow(other)).toBeUndefined();
    expect((await invitationRow(invitee))?.accepted_at).toBeNull();

    // Con la cuenta correcta, el mismo enlace sigue sirviendo.
    const right = await acceptWith(token, { sub: newSub(), email: invitee });

    expect(right.status).toBe(200);
  });

  it('con cuenta que nunca probó su correo, la vincula, borra su contraseña, cierra sus sesiones y avisa', async () => {
    const existing = await api.register('inv-google-sin-probar');
    const token = await invite(existing.email);

    const { status, body } = await acceptWith(token, { sub: newSub(), email: existing.email });

    expect(status).toBe(200);
    expect(body.activeStoreId).toBe(owner.storeId);

    const row = await userRow(existing.email);

    expect(row).toMatchObject({ password_hash: null, identities: 1 });
    expect(row?.email_verified_at).not.toBeNull();
    expect(await roleIn(existing.email, owner.storeId)).toBe('STAFF');

    const oldSession = await api.call('POST', '/auth/refresh', undefined, {
      refreshToken: existing.refreshToken,
    });

    expect(oldSession.status).toBe(401);
    expect(api.lastMailTo(existing.email)).toContain('borramos la contraseña');
  });

  it('con cuenta que ya probó su correo, la vincula y conserva la contraseña', async () => {
    const existing = await api.register('inv-google-probada');

    await api.withOwner((client) =>
      client.query('update users set email_verified_at = now() where email = $1', [existing.email]),
    );

    const token = await invite(existing.email);

    const { status } = await acceptWith(token, { sub: newSub(), email: existing.email });

    expect(status).toBe(200);
    expect(api.lastMailTo(existing.email)).not.toContain('borramos la contraseña');

    const login = await api.call('POST', '/auth/login', undefined, {
      email: existing.email,
      password: TEST_PASSWORD,
    });

    expect(login.status).toBe(200);
  });

  it('una identidad de Google atada a otra cuenta responde 409 y no crea nada', async () => {
    const sub = newSub();
    const holder = await api.register('inv-google-sub-titular');

    // El `sub` ya quedó vinculado a la cuenta del titular, con su correo.
    expect((await signInWith({ sub, email: holder.email })).status).toBe(200);

    // Google ahora presenta ese mismo `sub` con otro correo, el invitado.
    const invitee = api.email('inv-google-sub-invitada');
    const token = await invite(invitee);

    const { status, body } = await acceptWith(token, { sub, email: invitee });

    expect(status).toBe(409);
    expect(body.error).toBe('google_account_linked_elsewhere');
    expect(await userRow(invitee)).toBeUndefined();
    expect((await invitationRow(invitee))?.accepted_at).toBeNull();
  });

  it('una invitación vencida responde 400 y no crea la cuenta', async () => {
    const invitee = api.email('inv-google-vencida');
    const token = await invite(invitee);

    await api.withOwner((client) =>
      client.query(
        `update store_invitations set expires_at = now() - interval '1 minute'
          where store_id = $1 and email = $2`,
        [owner.storeId, invitee],
      ),
    );

    const { status, body } = await acceptWith(token, { sub: newSub(), email: invitee });

    expect(status).toBe(400);
    expect(body.message).toBe('La invitación no es válida, ya se usó o venció.');
    expect(await userRow(invitee)).toBeUndefined();
  });

  it('si Google no confirma el correo, responde 403 google_email_unverified y no crea nada', async () => {
    const invitee = api.email('inv-google-sin-verificar');
    const token = await invite(invitee);

    const { status, body } = await acceptWith(token, {
      sub: newSub(),
      email: invitee,
      emailVerified: false,
    });

    expect(status).toBe(403);
    expect(body.error).toBe('google_email_unverified');
    expect(await userRow(invitee)).toBeUndefined();
    expect((await invitationRow(invitee))?.accepted_at).toBeNull();
  });
});
