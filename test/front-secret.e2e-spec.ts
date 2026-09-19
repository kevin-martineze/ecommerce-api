import { FRONT_SECRET_HEADER } from '@shared/guards/front-secret.guard';

import { startTestApp, TestApp } from './utils/test-app';

/**
 * La puerta que deja entrar solo al frontend.
 *
 * `setup-env.ts` pone el secreto antes de importar `AppModule`, porque el
 * entorno se valida al cargarlo.
 */

const SECRET = process.env.API_SHARED_SECRET ?? '';

describe('Secreto del frontend (e2e)', () => {
  let api: TestApp;
  let slug: string;

  const withSecret = { [FRONT_SECRET_HEADER]: SECRET };

  beforeAll(async () => {
    api = await startTestApp();
    slug = (await api.register('front-secret')).slug;
  });

  afterAll(async () => {
    await api?.close();
  });

  it('sin el secreto no se entra a ninguna superficie', async () => {
    const store = await api.withoutSecret('GET', `/public/${slug}`);
    const login = await api.withoutSecret('POST', '/auth/login');
    const panel = await api.withoutSecret('GET', '/stores/cualquiera/products');

    expect([store.status, login.status, panel.status]).toEqual([403, 403, 403]);
  });

  it('con el secreto, la tienda pública responde', async () => {
    const { status } = await api.call('GET', `/public/${slug}`, undefined, undefined, withSecret);

    expect(status).toBe(200);
  });

  it('un secreto equivocado es 403, aunque mida lo mismo', async () => {
    const { status } = await api.call('GET', `/public/${slug}`, undefined, undefined, {
      [FRONT_SECRET_HEADER]: 'x'.repeat(SECRET.length),
    });

    expect(status).toBe(403);
  });

  it('las sondas de salud quedan abiertas: las consulta el supervisor', async () => {
    expect((await api.withoutSecret('GET', '/health')).status).toBe(200);
    expect((await api.withoutSecret('GET', '/health/ready')).status).toBe(200);
  });
});
