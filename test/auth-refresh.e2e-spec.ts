import { createHash } from 'node:crypto';

import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Rotación del refresh token frente a peticiones concurrentes.
 *
 * El frontend corre en funciones serverless: dos peticiones casi simultáneas
 * con la misma cookie vencida pueden caer en instancias distintas y refrescar
 * las dos con el mismo token. Eso es una carrera legítima, no un robo, y no
 * puede terminar con la dueña fuera de todas sus sesiones.
 */

jest.setTimeout(30_000);

interface SessionBody {
  refreshToken: string;
}

describe('Refresh de sesión (e2e)', () => {
  let api: TestApp;
  let account: Session;

  beforeAll(async () => {
    api = await startTestApp();
    account = await api.register('auth');
  });

  afterAll(async () => {
    await api?.close();
  });

  const login = async (): Promise<string> => {
    const { status, body } = await api.call<SessionBody>('POST', '/auth/login', undefined, {
      email: account.email,
      password: TEST_PASSWORD,
    });

    expect(status).toBe(200);

    return body.refreshToken;
  };

  const refresh = (refreshToken: string) =>
    api.call<SessionBody>('POST', '/auth/refresh', undefined, { refreshToken });

  /** Mueve la rotación de un token al pasado, para salir de la ventana de gracia sin esperar. */
  const ageRotation = (refreshToken: string) =>
    api.withOwner((client) =>
      client.query(
        `update refresh_tokens set revoked_at = now() - interval '5 minutes' where token_hash = $1`,
        [createHash('sha256').update(refreshToken).digest('hex')],
      ),
    );

  it('dos refresh simultáneos con el mismo token dejan las dos sesiones vivas', async () => {
    const token = await login();

    const [first, second] = await Promise.all([refresh(token), refresh(token)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await refresh(first.body.refreshToken)).status).toBe(200);
    expect((await refresh(second.body.refreshToken)).status).toBe(200);
  });

  it('un token recién rotado sigue sirviendo dentro de la ventana de gracia', async () => {
    const token = await login();

    const rotated = await refresh(token);
    const late = await refresh(token);

    expect(rotated.status).toBe(200);
    expect(late.status).toBe(200);
    expect(late.body.refreshToken).not.toBe(rotated.body.refreshToken);
  });

  it('reusar un token fuera de la ventana revoca todas las sesiones de la cuenta', async () => {
    const token = await login();
    const otherSession = await login();

    const rotated = await refresh(token);

    expect(rotated.status).toBe(200);

    await ageRotation(token);

    expect((await refresh(token)).status).toBe(401);
    expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
    expect((await refresh(otherSession)).status).toBe(401);
  });

  it('después de cerrar sesión, el token anterior no revive aunque esté en la ventana', async () => {
    const token = await login();

    const rotated = await refresh(token);
    const logout = await api.call('POST', '/auth/logout', undefined, {
      refreshToken: rotated.body.refreshToken,
    });

    expect(logout.status).toBe(204);
    expect((await refresh(token)).status).toBe(401);
  });

  it('una sesión cerrada que vuelve a presentarse no cierra las demás', async () => {
    const closed = await login();
    const alive = await login();

    await api.call('POST', '/auth/logout', undefined, { refreshToken: closed });

    expect((await refresh(closed)).status).toBe(401);
    expect((await refresh(alive)).status).toBe(200);
  });
});
