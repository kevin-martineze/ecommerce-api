import { TokenService } from '@modules/auth/providers/token.service';

import { FakeGoogle, FakeGoogleAccount, newCodeVerifier } from './utils/fake-google';
import { startTestApp, TestApp } from './utils/test-app';

/**
 * La parte de cuenta de Fase 4, contra la base de verdad:
 *
 * - `GET /auth/me` expone `signIn` (hasPassword y el vínculo de Google).
 * - `POST /auth/password/set` crea la primera contraseña de una cuenta solo-Google.
 * - `POST /auth/identities/google/unlink` desconecta Google sin dejar la cuenta
 *   sin forma de entrar.
 *
 * Las cuentas solo-Google se siembran directo en la base, como las deja el
 * registro con Google: `/auth/google` admite 10 por minuto y el registro 5, y
 * cada prueba necesita una cuenta fresca. Una prueba sí recorre el flujo real
 * para no depender solo de la siembra.
 */

jest.setTimeout(60_000);

const REDIRECT_URI = 'http://localhost:5173/auth/google/callback';
const NEW_PASSWORD = 'una contraseña nueva de la cuenta';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Owner {
  userId: string;
  token: string;
  refreshToken: string;
  storeId: string | null;
  email: string;
  account: FakeGoogleAccount;
}

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

interface MeBody {
  user: { id: string; email: string };
  signIn: {
    hasPassword: boolean;
    google: { email: string; linkedAt: string } | null;
  };
}

interface ErrorBody {
  message: string;
  error: string;
}

/** Un `sub` de Google de prueba: único por corrida y por llamada. */
const newSub = () => `${Date.now()}${Math.floor(Math.random() * 1e9)}`;

describe('Cuenta con Google: cómo entra, contraseña y desconectar (e2e)', () => {
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

  /** Una cuenta solo-Google por el flujo real: entrar con Google y completar el registro. */
  const registerWithGoogle = async (label: string): Promise<Owner> => {
    const account: FakeGoogleAccount = { sub: newSub(), email: api.email(label), name: label };
    const first = await signIn(account);

    if (first.body.status !== 'signup_required') {
      throw new Error(`Se esperaba el segundo paso del registro y llegó ${first.status}.`);
    }

    const created = await api.call<SessionBody>('POST', '/auth/google/register', undefined, {
      signupToken: first.body.signupToken,
      storeName: `Tienda ${label}`,
      storeSlug: `e2e-google-${newSub()}`,
      whatsappPhone: '573001234567',
    });

    if (created.status !== 201 || !created.body.activeStoreId) {
      throw new Error(`No se pudo registrar la cuenta de Google (HTTP ${created.status}).`);
    }

    api.forgetStore(created.body.activeStoreId);

    return {
      userId: created.body.user.id,
      token: created.body.accessToken,
      refreshToken: created.body.refreshToken,
      storeId: created.body.activeStoreId,
      email: account.email,
      account,
    };
  };

  /**
   * Una cuenta solo-Google sembrada: sin contraseña y con la identidad de
   * Google atada, con una sesión real emitida por el `TokenService` de la app.
   */
  const googleOnlyOwner = async (label: string): Promise<Owner> => {
    const account: FakeGoogleAccount = { sub: newSub(), email: api.email(label), name: label };

    const userId = await api.withOwner(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `with nuevo as (
           insert into users (id, email, full_name, password_hash, email_verified_at, updated_at)
           values (gen_random_uuid(), $1, $2, null, now(), now())
           returning id
         )
         insert into user_identities (id, user_id, provider, provider_subject, email)
         select gen_random_uuid(), id, 'google', $3, $1 from nuevo
         returning user_id as id`,
        [account.email, label, account.sub],
      );

      const row = rows[0];

      if (!row) {
        throw new Error('No se pudo sembrar la cuenta de Google.');
      }

      return row.id;
    });

    const session = await api.get(TokenService).issue(userId, account.email, null, {});

    return {
      userId,
      token: session.accessToken,
      refreshToken: session.refreshToken,
      storeId: null,
      email: account.email,
      account,
    };
  };

  /** Una sesión más de la misma cuenta: el "otro dispositivo". */
  const newSession = async (owner: Owner): Promise<{ refreshToken: string }> => {
    const session = await api.get(TokenService).issue(owner.userId, owner.email, null, {});

    return { refreshToken: session.refreshToken };
  };

  const login = (email: string, password: string) =>
    api.call<SessionBody>('POST', '/auth/login', undefined, { email, password });

  const refresh = (refreshToken: string) =>
    api.call<SessionBody>('POST', '/auth/refresh', undefined, { refreshToken });

  const userRow = async (email: string) => {
    const { rows } = await api.withOwner((client) =>
      client.query<{ password_hash: string | null; identities: number }>(
        `select u.password_hash,
                (select count(*)::int from user_identities i where i.user_id = u.id) as identities
           from users u where u.email = $1`,
        [email],
      ),
    );

    const row = rows[0];

    if (!row) {
      throw new Error(`No hay cuenta con el correo ${email}.`);
    }

    return row;
  };

  describe('GET /auth/me: signIn', () => {
    beforeAll(async () => {
      api = await startTestApp({ googleFetch: google.fetch });
    });

    afterAll(async () => {
      await api?.close();
    });

    it('cuenta con contraseña y sin Google: hasPassword true, google null', async () => {
      const owner = await api.register('me-clave');

      const { status, body } = await api.call<MeBody>('GET', '/auth/me', owner);

      expect(status).toBe(200);
      expect(body.signIn).toEqual({ hasPassword: true, google: null });
    });

    it('cuenta creada con Google (flujo real): hasPassword false, con el correo y la fecha del vínculo', async () => {
      const owner = await registerWithGoogle('me-flujo-real');

      const { status, body } = await api.call<MeBody>('GET', '/auth/me', owner);

      expect(status).toBe(200);
      expect(body.signIn).toEqual({
        hasPassword: false,
        google: { email: owner.email, linkedAt: expect.stringMatching(ISO_DATE) },
      });
    });

    it('nunca sale el hash de la contraseña ni el sub de Google', async () => {
      const owner = await api.register('me-sin-secretos');
      const { body } = await api.call<MeBody>('GET', '/auth/me', owner);
      const raw = JSON.stringify(body);
      const row = await userRow(owner.email);

      expect(row.password_hash).not.toBeNull();
      expect(raw).not.toContain(row.password_hash ?? '');
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('$argon2');
    });

    it('sin sesión responde 401', async () => {
      expect((await api.call('GET', '/auth/me')).status).toBe(401);
    });
  });

  // Cada bloque levanta su propia API: el límite por minuto de cada ruta vive en la aplicación.
  describe('POST /auth/password/set', () => {
    beforeAll(async () => {
      api = await startTestApp({ googleFetch: google.fetch });
    });

    afterAll(async () => {
      await api?.close();
    });

    it('sin sesión responde 401', async () => {
      const { status } = await api.call('POST', '/auth/password/set', undefined, {
        newPassword: NEW_PASSWORD,
        refreshToken: 'refresh-de-prueba-con-largo-suficiente',
      });

      expect(status).toBe(401);
    });

    it('la contraseña nueva sigue las reglas de siempre: doce caracteres como mínimo', async () => {
      const owner = await googleOnlyOwner('set-corta');

      const { status } = await api.call('POST', '/auth/password/set', owner, {
        newPassword: 'corta',
        refreshToken: owner.refreshToken,
      });

      expect(status).toBe(400);
      expect((await userRow(owner.email)).password_hash).toBeNull();
    });

    it('crea la contraseña: 204, la cuenta ya entra con ella y la sesión que lo hizo sigue viva', async () => {
      const owner = await googleOnlyOwner('set-ok');

      const created = await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      expect(created.status).toBe(204);
      expect((await userRow(owner.email)).password_hash).not.toBeNull();
      expect((await login(owner.email, NEW_PASSWORD)).status).toBe(200);
      expect((await refresh(owner.refreshToken)).status).toBe(200);

      const me = await api.call<MeBody>('GET', '/auth/me', owner);

      expect(me.body.signIn).toEqual({
        hasPassword: true,
        google: { email: owner.email, linkedAt: expect.stringMatching(ISO_DATE) },
      });
    });

    it('cierra las demás sesiones de la cuenta', async () => {
      const owner = await googleOnlyOwner('set-cierra');
      const other = await newSession(owner);

      const created = await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      expect(created.status).toBe(204);
      expect((await refresh(other.refreshToken)).status).toBe(401);
      expect((await refresh(owner.refreshToken)).status).toBe(200);
    });

    it('manda el aviso "Se creó una contraseña para tu cuenta" con el enlace de recuperación', async () => {
      const owner = await googleOnlyOwner('set-aviso');

      await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      const mail = api.lastMailTo(owner.email);

      expect(mail).toContain('Se creó una contraseña para tu cuenta');
      expect(mail).toContain('/admin/forgot-password');
    });

    it('con contraseña ya fijada responde 409 password_already_set y no cambia nada', async () => {
      const owner = await googleOnlyOwner('set-dos-veces');

      await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });
      const hashed = (await userRow(owner.email)).password_hash;

      const again = await api.call<ErrorBody>('POST', '/auth/password/set', owner, {
        newPassword: 'otra contraseña nueva de prueba',
        refreshToken: owner.refreshToken,
      });

      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        message: 'Tu cuenta ya tiene contraseña. Para cambiarla, usa cambiar contraseña.',
        error: 'password_already_set',
      });
      expect((await userRow(owner.email)).password_hash).toBe(hashed);
    });

    it('una cuenta registrada con contraseña responde 409 y conserva su contraseña', async () => {
      const owner = await api.register('set-con-clave');

      const { status, body } = await api.call<ErrorBody>('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      expect(status).toBe(409);
      expect(body.error).toBe('password_already_set');
      expect((await userRow(owner.email)).password_hash).not.toBeNull();
    });
  });

  describe('POST /auth/identities/google/unlink', () => {
    beforeAll(async () => {
      api = await startTestApp({ googleFetch: google.fetch });
    });

    afterAll(async () => {
      await api?.close();
    });

    it('sin sesión responde 401', async () => {
      const { status } = await api.call('POST', '/auth/identities/google/unlink', undefined, {
        refreshToken: 'refresh-de-prueba-con-largo-suficiente',
      });

      expect(status).toBe(401);
    });

    it('sin contraseña responde 409 password_required y deja el vínculo como estaba', async () => {
      const owner = await googleOnlyOwner('unlink-sin-clave');

      const { status, body } = await api.call<ErrorBody>(
        'POST',
        '/auth/identities/google/unlink',
        owner,
        { refreshToken: owner.refreshToken },
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({
        message: 'Crea una contraseña antes de desconectar Google: si no, no podrías entrar.',
        error: 'password_required',
      });
      expect((await userRow(owner.email)).identities).toBe(1);
    });

    it('sin Google vinculado responde 404 google_not_linked', async () => {
      const owner = await api.register('unlink-sin-google');

      const { status, body } = await api.call<ErrorBody>(
        'POST',
        '/auth/identities/google/unlink',
        owner,
        { refreshToken: owner.refreshToken },
      );

      expect(status).toBe(404);
      expect(body).toMatchObject({
        message: 'Esta cuenta no tiene Google conectado.',
        error: 'google_not_linked',
      });
    });

    it('desconecta: 204, la cuenta sigue entrando con contraseña y la otra sesión se cierra', async () => {
      const owner = await googleOnlyOwner('unlink-ok');

      await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      // Una sesión creada después de fijar la contraseña: la que se tiene que cerrar.
      const otherDevice = await login(owner.email, NEW_PASSWORD);

      expect(otherDevice.status).toBe(200);

      const unlinked = await api.call('POST', '/auth/identities/google/unlink', owner, {
        refreshToken: owner.refreshToken,
      });

      expect(unlinked.status).toBe(204);
      expect((await userRow(owner.email)).identities).toBe(0);
      expect((await login(owner.email, NEW_PASSWORD)).status).toBe(200);
      expect((await refresh(otherDevice.body.refreshToken)).status).toBe(401);
      expect((await refresh(owner.refreshToken)).status).toBe(200);

      const me = await api.call<MeBody>('GET', '/auth/me', owner);

      expect(me.body.signIn).toEqual({ hasPassword: true, google: null });
    });

    it('avisa por correo que se desconectó Google', async () => {
      const owner = await googleOnlyOwner('unlink-aviso');

      await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });
      await api.call('POST', '/auth/identities/google/unlink', owner, {
        refreshToken: owner.refreshToken,
      });

      expect(api.lastMailTo(owner.email)).toContain('Desconectaste Google de tu cuenta');
    });

    it('volver a entrar con Google después de desconectarlo conserva la contraseña', async () => {
      const owner = await googleOnlyOwner('unlink-vuelve');

      const created = await api.call('POST', '/auth/password/set', owner, {
        newPassword: NEW_PASSWORD,
        refreshToken: owner.refreshToken,
      });
      const unlinked = await api.call('POST', '/auth/identities/google/unlink', owner, {
        refreshToken: owner.refreshToken,
      });

      expect([created.status, unlinked.status]).toEqual([204, 204]);

      // La cuenta no tiene vínculo: entrar con Google la encuentra por correo y la vincula de nuevo.
      const back = await signIn(owner.account);

      expect(back.status).toBe(200);
      expect(back.body.status).toBe('session');

      const row = await userRow(owner.email);

      expect(row.identities).toBe(1);
      expect(row.password_hash).not.toBeNull();
    });

    it('carrera con password/set: la cuenta nunca queda sin forma de entrar', async () => {
      const owner = await googleOnlyOwner('carrera');

      const [created, unlinked] = await Promise.all([
        api.call('POST', '/auth/password/set', owner, {
          newPassword: NEW_PASSWORD,
          refreshToken: owner.refreshToken,
        }),
        api.call('POST', '/auth/identities/google/unlink', owner, {
          refreshToken: owner.refreshToken,
        }),
      ]);

      // password/set siempre gana: la cuenta no tiene contraseña cuando arranca.
      expect(created.status).toBe(204);

      // unlink corre antes (409, sin contraseña todavía) o después (204, ya con ella).
      expect([204, 409]).toContain(unlinked.status);

      const row = await userRow(owner.email);

      expect(row.password_hash).not.toBeNull();
      expect(row.identities).toBe(unlinked.status === 204 ? 0 : 1);
    });
  });
});
