import { hashSync } from 'bcryptjs';

import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Cuentas migradas desde Supabase: entran con su contraseña de siempre y, en
 * ese primer login, el hash bcrypt se reemplaza por argon2id.
 */

jest.setTimeout(30_000);

describe('Contraseñas migradas desde Supabase (e2e)', () => {
  let api: TestApp;
  let account: Session;

  beforeAll(async () => {
    api = await startTestApp();
    account = await api.register('legacy');
  });

  afterAll(async () => {
    await api?.close();
  });

  /** Como lo guarda Supabase Auth: bcrypt con prefijo `$2a$`. */
  const supabaseHash = (plain: string) => hashSync(plain, 10).replace(/^\$2b\$/, '$2a$');

  const storedHash = async (): Promise<string | undefined> => {
    const { rows } = await api.withOwner((client) =>
      client.query<{ password_hash: string }>('select password_hash from users where email = $1', [
        account.email,
      ]),
    );

    return rows[0]?.password_hash;
  };

  const setHash = (hash: string) =>
    api.withOwner((client) =>
      client.query('update users set password_hash = $1 where email = $2', [hash, account.email]),
    );

  const login = (password: string) =>
    api.call('POST', '/auth/login', undefined, { email: account.email, password });

  it('con la contraseña equivocada no entra y el hash bcrypt queda intacto', async () => {
    const legacy = supabaseHash(TEST_PASSWORD);

    await setHash(legacy);

    expect((await login('otra contraseña cualquiera')).status).toBe(401);
    expect(await storedHash()).toBe(legacy);
  });

  it('con la contraseña de siempre entra, y el hash pasa a argon2id', async () => {
    await setHash(supabaseHash(TEST_PASSWORD));

    expect((await login(TEST_PASSWORD)).status).toBe(200);
    expect(await storedHash()).toMatch(/^\$argon2id\$/);

    // Y la misma contraseña sigue sirviendo con el hash nuevo.
    expect((await login(TEST_PASSWORD)).status).toBe(200);
  });
});
