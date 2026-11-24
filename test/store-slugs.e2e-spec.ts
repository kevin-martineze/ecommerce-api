import { randomBytes } from 'node:crypto';

import { Session, startTestApp, TestApp, TEST_PASSWORD } from './utils/test-app';

/**
 * Cambio de subdominio de punta a punta: la consola lo cambia, la tienda
 * pública responde en el nuevo, el anterior dice a dónde se mudó y nadie más
 * lo puede tomar.
 */

jest.setTimeout(120_000);

interface DetailBody {
  slug: string;
  publicUrl: string;
}

interface ErrorBody {
  message: string | string[];
  error?: string;
}

/** Un subdominio único por corrida, para no chocar con datos viejos. */
const fresh = (label: string) => `${label}-${randomBytes(3).toString('hex')}`;

describe('cambio de subdominio', () => {
  let api: TestApp;
  let owner: Session;
  let other: Session;
  let admin: Session;
  let original: string;
  let moved: string;

  const changeSlug = <T>(session: Session, storeId: string, slug: string) =>
    api.call<T>('PATCH', `/platform/stores/${storeId}/slug`, session, { slug });

  beforeAll(async () => {
    api = await startTestApp();

    owner = await api.register('subdominio-duena');
    other = await api.register('subdominio-otra');
    admin = await api.register('subdominio-admin');

    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        admin.email,
      ]),
    );

    original = owner.slug;
    moved = fresh('mudanza');
  });

  afterAll(async () => {
    await api.close();
  });

  it('solo quien administra la plataforma lo puede cambiar', async () => {
    const { status } = await changeSlug(owner, owner.storeId, moved);

    expect(status).toBe(403);
  });

  it('rechaza un formato que no sirve de host y los reservados', async () => {
    for (const slug of ['Con-Mayuscula', 'con.punto', '-guion', 'www']) {
      const { status } = await changeSlug(admin, owner.storeId, slug);

      expect(status).toBe(400);
    }
  });

  it('no toma el subdominio de otra tienda', async () => {
    const { status, body } = await changeSlug<ErrorBody>(admin, owner.storeId, other.slug);

    expect(status).toBe(409);
    expect(body.error).toBe('slug_taken');
  });

  it('la tienda pasa al subdominio nuevo y la pública responde ahí', async () => {
    const { status, body } = await changeSlug<DetailBody>(admin, owner.storeId, moved);

    expect(status).toBe(200);
    expect(body.slug).toBe(moved);
    expect(body.publicUrl).toContain(`${moved}.`);

    expect((await api.call('GET', `/public/${moved}`)).status).toBe(200);
    expect((await api.call('GET', `/public/${original}`)).status).toBe(404);
  });

  it('el subdominio anterior dice a dónde se mudó la tienda', async () => {
    const { status, body } = await api.call<{ slug: string }>('GET', `/store-slugs/${original}`);

    expect(status).toBe(200);
    expect(body).toEqual({ slug: moved });
  });

  it('un subdominio que nunca fue de una tienda no lleva a ninguna parte', async () => {
    const { status } = await api.call('GET', `/store-slugs/${fresh('nadie')}`);

    expect(status).toBe(404);
  });

  it('nadie puede registrar el subdominio anterior', async () => {
    const { status, body } = await api.call<ErrorBody>('POST', '/auth/register', undefined, {
      email: `e2e-${fresh('ladrona')}@tienda.test`,
      password: TEST_PASSWORD,
      fullName: 'Prueba ladrona',
      storeName: 'Tienda ladrona',
      storeSlug: original,
      whatsappPhone: '573001234567',
    });

    expect(status).toBe(409);
    expect(body.error).toBe('slug_taken');
  });

  it('otra tienda tampoco lo puede tomar desde la consola', async () => {
    const { status, body } = await changeSlug<ErrorBody>(admin, other.storeId, original);

    expect(status).toBe(409);
    expect(body.error).toBe('slug_taken');
  });

  it('la tienda puede volver a un subdominio que ya tuvo', async () => {
    const { status, body } = await changeSlug<DetailBody>(admin, owner.storeId, original);

    expect(status).toBe(200);
    expect(body.slug).toBe(original);

    // El que deja ahora redirige al de siempre, y el de siempre ya no es un alias.
    const former = await api.call<{ slug: string }>('GET', `/store-slugs/${moved}`);

    expect(former.body).toEqual({ slug: original });
    expect((await api.call('GET', `/store-slugs/${original}`)).status).toBe(404);
  });

  it('una tienda suspendida no revela a dónde se mudó', async () => {
    const suspended = await api.call('PATCH', `/platform/stores/${owner.storeId}/status`, admin, {
      status: 'SUSPENDED',
    });

    expect(suspended.status).toBe(200);

    expect((await api.call('GET', `/store-slugs/${moved}`)).status).toBe(404);
  });
});
