import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Cuenta y equipo: recuperar y cambiar la contraseña, invitar, aceptar,
 * cambiar roles y quitar miembros.
 */

jest.setTimeout(60_000);

const NEW_PASSWORD = 'otra contraseña bastante larga';

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  activeStoreId: string | null;
  stores: { id: string; role: string }[];
}

interface Member {
  userId: string;
  email: string;
  role: string;
}

/** Saca el valor de `token=` del enlace que llegó en el correo. */
function tokenFrom(mail: string | null): string {
  const match = /token=([^\s]+)/.exec(mail ?? '');

  if (!match?.[1]) {
    throw new Error(`El correo no trae enlace: ${mail}`);
  }

  return match[1];
}

describe('Cuenta y equipo (e2e)', () => {
  let api: TestApp;
  let owner: Session;

  const login = (email: string, password: string) =>
    api.call<SessionBody>('POST', '/auth/login', undefined, { email, password });

  const team = <T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    session: Session | { token: string } = owner,
    payload?: object,
  ) => api.call<T>(method, `/stores/${owner.storeId}${url}`, session, payload);

  beforeAll(async () => {
    api = await startTestApp();
    owner = await api.register('account-owner');
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('recuperar contraseña', () => {
    it('responde igual exista o no la cuenta, y solo escribe a la que existe', async () => {
      const ghost = api.email('ghost');

      const real = await api.call('POST', '/auth/password/forgot', undefined, {
        email: owner.email.toUpperCase(),
      });
      const missing = await api.call('POST', '/auth/password/forgot', undefined, { email: ghost });

      expect([real.status, missing.status]).toEqual([204, 204]);
      expect(api.lastMailTo(owner.email)).toContain('/admin/restablecer?token=');
      expect(api.lastMailTo(ghost)).toBeNull();
    });

    it('un enlace nuevo anula el anterior', async () => {
      const first = tokenFrom(api.lastMailTo(owner.email));

      await api.call('POST', '/auth/password/forgot', undefined, { email: owner.email });

      const reuse = await api.call('POST', '/auth/password/reset', undefined, {
        token: first,
        password: NEW_PASSWORD,
      });

      expect(reuse.status).toBe(400);
    });

    it('fija la contraseña, cierra todas las sesiones y el enlace no sirve dos veces', async () => {
      const token = tokenFrom(api.lastMailTo(owner.email));

      const reset = await api.call('POST', '/auth/password/reset', undefined, {
        token,
        password: NEW_PASSWORD,
      });

      expect(reset.status).toBe(204);

      const oldSession = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: owner.refreshToken,
      });

      expect(oldSession.status).toBe(401);
      expect((await login(owner.email, TEST_PASSWORD)).status).toBe(401);

      const fresh = await login(owner.email, NEW_PASSWORD);

      expect(fresh.status).toBe(200);
      owner = { ...owner, token: fresh.body.accessToken, refreshToken: fresh.body.refreshToken };

      const again = await api.call('POST', '/auth/password/reset', undefined, {
        token,
        password: 'una tercera contraseña larga',
      });

      expect(again.status).toBe(400);
    });
  });

  describe('cambiar contraseña', () => {
    it('exige la actual; la sesión que la cambia sigue viva y las demás se cierran', async () => {
      const other = await login(owner.email, NEW_PASSWORD);

      const wrong = await api.call('POST', '/auth/password/change', owner, {
        currentPassword: 'no es esta',
        newPassword: TEST_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      expect(wrong.status).toBe(401);

      const changed = await api.call('POST', '/auth/password/change', owner, {
        currentPassword: NEW_PASSWORD,
        newPassword: TEST_PASSWORD,
        refreshToken: owner.refreshToken,
      });

      expect(changed.status).toBe(204);

      const kept = await api.call<SessionBody>('POST', '/auth/refresh', undefined, {
        refreshToken: owner.refreshToken,
      });
      const closed = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: other.body.refreshToken,
      });

      expect(kept.status).toBe(200);
      expect(closed.status).toBe(401);

      owner = { ...owner, token: kept.body.accessToken, refreshToken: kept.body.refreshToken };
    });
  });

  describe('equipo', () => {
    const invitee = () => api.email('invitee');
    let staffEmail: string;
    let staffSession: SessionBody;

    it('me dice si la cuenta administra la plataforma', async () => {
      const me = await api.call<{ isPlatformAdmin: boolean }>('GET', '/auth/me', owner);

      expect(me.body.isPlatformAdmin).toBe(false);
    });

    it('invita a un correo sin cuenta; la invitación nueva anula la anterior', async () => {
      staffEmail = invitee();

      const first = await team('POST', '/invitations', owner, { email: staffEmail, role: 'STAFF' });

      expect(first.status).toBe(201);

      const firstToken = tokenFrom(api.lastMailTo(staffEmail));

      await team('POST', '/invitations', owner, { email: staffEmail.toUpperCase(), role: 'STAFF' });

      const pending = await team<{ email: string }[]>('GET', '/invitations');

      expect(pending.body.filter((row) => row.email === staffEmail)).toHaveLength(1);
      expect((await api.call('GET', `/auth/invitations/${firstToken}`)).status).toBe(404);
    });

    it('el enlace muestra la tienda y crea la cuenta al aceptar, ya dentro de la tienda', async () => {
      const token = tokenFrom(api.lastMailTo(staffEmail));

      const preview = await api.call<{ email: string; role: string; accountExists: boolean }>(
        'GET',
        `/auth/invitations/${token}`,
      );

      expect(preview.body).toMatchObject({
        email: staffEmail,
        role: 'STAFF',
        accountExists: false,
      });

      const noName = await api.call('POST', '/auth/invitations/accept', undefined, {
        token,
        password: TEST_PASSWORD,
      });

      expect(noName.status).toBe(400);

      const accepted = await api.call<SessionBody>('POST', '/auth/invitations/accept', undefined, {
        token,
        password: TEST_PASSWORD,
        fullName: 'Ayudante',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.activeStoreId).toBe(owner.storeId);
      staffSession = accepted.body;

      const reused = await api.call('POST', '/auth/invitations/accept', undefined, {
        token,
        password: TEST_PASSWORD,
        fullName: 'Ayudante',
      });

      expect(reused.status).toBe(400);
    });

    it('el personal opera el catálogo pero no gestiona el equipo', async () => {
      const staff = { token: staffSession.accessToken };

      expect((await team('GET', '/products', staff)).status).toBe(200);
      expect((await team('GET', '/members', staff)).status).toBe(200);
      expect((await team('GET', '/invitations', staff)).status).toBe(403);
      expect(
        (await team('POST', '/invitations', staff, { email: invitee(), role: 'OWNER' })).status,
      ).toBe(403);
    });

    it('una cuenta existente acepta con su contraseña, no con una nueva', async () => {
      const other = await api.register('account-other');

      await team('POST', '/invitations', owner, { email: other.email, role: 'OWNER' });

      const token = tokenFrom(api.lastMailTo(other.email));
      const preview = await api.call<{ accountExists: boolean }>(
        'GET',
        `/auth/invitations/${token}`,
      );

      expect(preview.body.accountExists).toBe(true);

      const wrong = await api.call('POST', '/auth/invitations/accept', undefined, {
        token,
        password: 'no es la de esta cuenta',
      });

      expect(wrong.status).toBe(401);

      const accepted = await api.call<SessionBody>('POST', '/auth/invitations/accept', undefined, {
        token,
        password: TEST_PASSWORD,
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.stores.map((store) => store.id)).toEqual(
        expect.arrayContaining([other.storeId, owner.storeId]),
      );
    });

    it('no invita a quien ya es parte del equipo', async () => {
      const again = await team('POST', '/invitations', owner, { email: staffEmail, role: 'STAFF' });

      expect(again.status).toBe(409);
    });

    it('la tienda nunca queda sin dueña', async () => {
      const members = (await team<Member[]>('GET', '/members')).body;
      const self = members.find((member) => member.email === owner.email);
      const coOwner = members.find(
        (member) => member.role === 'OWNER' && member.email !== owner.email,
      );

      if (!self || !coOwner) {
        throw new Error('Faltan miembros de prueba.');
      }

      expect((await team('DELETE', `/members/${coOwner.userId}`)).status).toBe(204);

      const demoteLast = await team<{ message: string }>(
        'PATCH',
        `/members/${self.userId}`,
        owner,
        {
          role: 'STAFF',
        },
      );

      expect(demoteLast.status).toBe(409);
      expect((await team('DELETE', `/members/${self.userId}`)).status).toBe(409);
    });

    it('promover y quitar al personal; quitarlo cierra su sesión en la tienda', async () => {
      const members = (await team<Member[]>('GET', '/members')).body;
      const staff = members.find((member) => member.email === staffEmail);

      if (!staff) {
        throw new Error('Falta el personal de prueba.');
      }

      const promoted = await team<Member[]>('PATCH', `/members/${staff.userId}`, owner, {
        role: 'OWNER',
      });

      expect(promoted.body.find((member) => member.userId === staff.userId)?.role).toBe('OWNER');
      expect((await team('DELETE', `/members/${staff.userId}`)).status).toBe(204);

      const refresh = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: staffSession.refreshToken,
      });

      expect(refresh.status).toBe(401);
      expect((await team('GET', '/products', { token: staffSession.accessToken })).status).toBe(
        403,
      );
    });

    it('anula una invitación pendiente', async () => {
      const email = invitee();
      const created = await team<{ id: string }>('POST', '/invitations', owner, {
        email,
        role: 'STAFF',
      });
      const token = tokenFrom(api.lastMailTo(email));

      expect((await team('DELETE', `/invitations/${created.body.id}`)).status).toBe(204);
      expect((await team('DELETE', `/invitations/${created.body.id}`)).status).toBe(404);
      expect((await api.call('GET', `/auth/invitations/${token}`)).status).toBe(404);
    });
  });
});
