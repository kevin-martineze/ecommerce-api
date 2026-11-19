import { existsSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import { Session, startTestApp, TEST_PASSWORD, TestApp, TestFile } from './utils/test-app';

/**
 * Cuentas de la plataforma: verlas, deshabilitarlas, eliminarlas, y el borrado
 * definitivo de una tienda con sus fotos.
 */

jest.setTimeout(60_000);

interface UserRow {
  id: string;
  email: string;
  disabledAt: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  isPlatformAdmin: boolean;
  memberships: { storeId: string; role: string; storeStatus: string }[];
}

interface UserDetail extends UserRow {
  soleOwnerStores: { id: string; slug: string }[];
}

interface ErrorBody {
  message: string;
  error?: string;
}

async function photo(): Promise<TestFile> {
  const data = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: { r: 90, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();

  return { field: 'file', filename: 'foto.png', contentType: 'image/png', data };
}

describe('Cuentas de la plataforma (e2e)', () => {
  let api: TestApp;
  let admin: Session;

  const platform = <T>(method: 'GET' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    api.call<T>(method, `/platform${url}`, admin, payload);

  const userIdOf = async (email: string): Promise<string> => {
    const { body } = await platform<UserRow[]>('GET', `/users?q=${encodeURIComponent(email)}`);
    const row = body.find((user) => user.email === email);

    if (!row) throw new Error(`No apareció la cuenta ${email}`);

    return row.id;
  };

  /** La clave del archivo es lo que la URL pública lleva después de `stores/`. */
  const fileOf = (url: string) => join(api.mediaDir, url.slice(url.indexOf('stores/')));

  beforeAll(async () => {
    api = await startTestApp();
    admin = await api.register('cuentas-admin');

    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        admin.email,
      ]),
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('listado', () => {
    it('una dueña común no ve las cuentas', async () => {
      const shop = await api.register('cuentas-comun');

      expect((await api.call('GET', '/platform/users', shop)).status).toBe(403);
    });

    it('busca por correo y muestra sus tiendas y cómo entra', async () => {
      const shop = await api.register('cuentas-busca');
      const { status, body } = await platform<UserRow[]>(
        'GET',
        `/users?q=${encodeURIComponent(shop.email)}`,
      );

      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        email: shop.email,
        disabledAt: null,
        hasPassword: true,
        hasGoogle: false,
        isPlatformAdmin: false,
        memberships: [{ storeId: shop.storeId, role: 'OWNER', storeStatus: 'TRIAL' }],
      });
      expect(body[0]).not.toHaveProperty('passwordHash');
    });

    it('busca por el slug de su tienda', async () => {
      const shop = await api.register('cuentas-slug');
      const { body } = await platform<UserRow[]>('GET', `/users?q=${shop.slug}`);

      expect(body.map((user) => user.email)).toEqual([shop.email]);
    });
  });

  describe('deshabilitar', () => {
    it('cierra sus sesiones, no la deja entrar y corta el panel con el token vigente', async () => {
      const shop = await api.register('cuentas-deshabilitar');
      const userId = await userIdOf(shop.email);

      const disabled = await platform<UserDetail>('PATCH', `/users/${userId}/status`, {
        disabled: true,
      });

      expect(disabled.status).toBe(200);
      expect(disabled.body.disabledAt).not.toBeNull();

      // El access token sigue firmado; el guard lo corta en la siguiente petición.
      const panel = await api.call<ErrorBody>('GET', `/stores/${shop.storeId}/settings`, shop);

      expect(panel.status).toBe(403);
      expect(panel.body.error).toBe('account_disabled');

      const me = await api.call<ErrorBody>('GET', '/auth/me', shop);

      expect(me.status).toBe(403);

      const refresh = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: shop.refreshToken,
      });

      expect(refresh.status).toBe(401);

      const login = await api.call<ErrorBody>('POST', '/auth/login', undefined, {
        email: shop.email,
        password: TEST_PASSWORD,
      });

      expect(login.status).toBe(403);
      expect(login.body.error).toBe('account_disabled');

      await api.call('POST', '/auth/password/forgot', undefined, { email: shop.email });

      expect(api.lastMailTo(shop.email)).toBeNull();
    });

    it('reactivarla le devuelve la entrada', async () => {
      const shop = await api.register('cuentas-reactivar');
      const userId = await userIdOf(shop.email);

      await platform('PATCH', `/users/${userId}/status`, { disabled: true });

      const enabled = await platform<UserDetail>('PATCH', `/users/${userId}/status`, {
        disabled: false,
      });

      expect(enabled.body.disabledAt).toBeNull();

      const login = await api.call('POST', '/auth/login', undefined, {
        email: shop.email,
        password: TEST_PASSWORD,
      });

      expect(login.status).toBe(200);

      const filtered = await platform<UserRow[]>('GET', `/users?status=disabled&q=${shop.slug}`);

      expect(filtered.body).toEqual([]);
    });

    it('nadie se deshabilita a sí misma ni a otra administradora', async () => {
      const adminId = await userIdOf(admin.email);
      const self = await platform<ErrorBody>('PATCH', `/users/${adminId}/status`, {
        disabled: true,
      });

      expect(self.status).toBe(403);

      const other = await api.register('cuentas-otra-admin');

      await api.withOwner((client) =>
        client.query(
          `insert into platform_admins (user_id) select id from users where email = $1`,
          [other.email],
        ),
      );

      const otherId = await userIdOf(other.email);

      expect((await platform('PATCH', `/users/${otherId}/status`, { disabled: true })).status).toBe(
        403,
      );
      expect(
        (
          await platform('DELETE', `/users/${otherId}`, {
            confirmEmail: other.email,
            deleteStoreIds: [],
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('eliminar una tienda', () => {
    it('solo si está suspendida y con el slug bien escrito; se lleva sus fotos', async () => {
      const shop = await api.register('cuentas-borrar-tienda');
      const product = await api.seedProduct(shop, { name: 'Blusa', basePrice: 89_900 });
      const image = await api.upload<{ urlFull: string; urlThumb: string }>(
        'POST',
        `/stores/${shop.storeId}/products/${product.id}/images`,
        shop,
        await photo(),
      );
      const logo = await api.upload<{ logoUrl: string }>(
        'PUT',
        `/stores/${shop.storeId}/settings/logo`,
        shop,
        await photo(),
      );

      expect(image.status).toBe(201);
      expect(existsSync(fileOf(image.body.urlFull))).toBe(true);
      expect(existsSync(fileOf(logo.body.logoUrl))).toBe(true);

      const active = await platform<ErrorBody>('DELETE', `/stores/${shop.storeId}`, {
        confirmSlug: shop.slug,
      });

      expect(active.status).toBe(409);

      await api.call('PATCH', `/platform/stores/${shop.storeId}/status`, admin, {
        status: 'SUSPENDED',
      });

      const typo = await platform('DELETE', `/stores/${shop.storeId}`, {
        confirmSlug: `${shop.slug}-x`,
      });

      expect(typo.status).toBe(400);

      const deleted = await platform('DELETE', `/stores/${shop.storeId}`, {
        confirmSlug: shop.slug,
      });

      expect(deleted.status).toBe(204);
      expect((await api.call('GET', `/platform/stores/${shop.storeId}`, admin)).status).toBe(404);
      expect((await api.call('GET', `/public/${shop.slug}`)).status).toBe(404);
      expect(existsSync(fileOf(image.body.urlFull))).toBe(false);
      expect(existsSync(fileOf(image.body.urlThumb))).toBe(false);
      expect(existsSync(fileOf(logo.body.logoUrl))).toBe(false);

      // La cuenta sigue, sin la tienda; su sesión de esa tienda ya no renueva.
      const userId = await userIdOf(shop.email);
      const detail = await platform<UserDetail>('GET', `/users/${userId}`);

      expect(detail.body.memberships).toEqual([]);

      const refresh = await api.call('POST', '/auth/refresh', undefined, {
        refreshToken: shop.refreshToken,
      });

      expect(refresh.status).toBe(401);
    });
  });

  describe('eliminar una cuenta', () => {
    it('la ficha lista las tiendas donde es la única dueña', async () => {
      const shop = await api.register('cuentas-ficha');
      const userId = await userIdOf(shop.email);
      const { body } = await platform<UserDetail>('GET', `/users/${userId}`);

      expect(body.soleOwnerStores).toEqual([
        expect.objectContaining({ id: shop.storeId, slug: shop.slug }),
      ]);
    });

    it('con el correo mal escrito no borra nada', async () => {
      const shop = await api.register('cuentas-correo-mal');
      const userId = await userIdOf(shop.email);

      const { status } = await platform('DELETE', `/users/${userId}`, {
        confirmEmail: `x${shop.email}`,
        deleteStoreIds: [shop.storeId],
      });

      expect(status).toBe(400);
      expect((await platform('GET', `/users/${userId}`)).status).toBe(200);
    });

    it('si la lista de tiendas no es la que calcula la API, 409 y no borra nada', async () => {
      const shop = await api.register('cuentas-lista-vieja');
      const userId = await userIdOf(shop.email);

      const { status } = await platform('DELETE', `/users/${userId}`, {
        confirmEmail: shop.email,
        deleteStoreIds: [],
      });

      expect(status).toBe(409);
      expect((await api.call('GET', `/public/${shop.slug}`)).status).toBe(200);
    });

    it('borra la cuenta y su tienda; la cuenta ya no entra', async () => {
      const shop = await api.register('cuentas-borrar');
      const userId = await userIdOf(shop.email);

      const deleted = await platform('DELETE', `/users/${userId}`, {
        confirmEmail: shop.email.toUpperCase(),
        deleteStoreIds: [shop.storeId],
      });

      expect(deleted.status).toBe(204);
      expect((await platform('GET', `/users/${userId}`)).status).toBe(404);
      expect((await api.call('GET', `/platform/stores/${shop.storeId}`, admin)).status).toBe(404);

      const login = await api.call('POST', '/auth/login', undefined, {
        email: shop.email,
        password: TEST_PASSWORD,
      });

      expect(login.status).toBe(401);
    });
  });
});
