import { randomBytes } from 'node:crypto';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Dominios propios de punta a punta, con el driver `log` (el de desarrollo):
 * cualquier host se verifica, salvo los que empiezan por `pendiente.`.
 *
 * Cubre el contrato que consume el frontend: el panel de la dueña, la
 * resolución pública del host, y `publicUrl` en los tres sitios donde viaja.
 */

jest.setTimeout(120_000);

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface DomainBody {
  host: string;
  status: string;
  dnsRecords: DnsRecord[];
  verifiedAt: string | null;
  lastError: string | null;
}

interface DomainState {
  allowed: boolean;
  domain: DomainBody | null;
}

interface SettingsBody {
  publicUrl: string;
}

interface StorefrontBody {
  store: { slug: string; publicUrl: string };
}

interface PlatformDetailBody {
  publicUrl: string;
  customDomainStatus: string | null;
}

interface PublicDomainBody {
  slug: string;
  status: string;
}

/** Un dominio único por corrida, para que los e2e no choquen entre sí ni con datos viejos. */
const uniqueBase = (label: string) => `${label}-${randomBytes(3).toString('hex')}.com`;

describe('dominios propios', () => {
  let api: TestApp;
  let owner: Session; // plan pro: incluye dominio propio
  let rival: Session; // plan pro, otra tienda
  let basic: Session; // plan básico: no incluye dominio propio
  let admin: Session; // administradora de la plataforma
  let staff: Session; // personal de la tienda de la dueña, no OWNER
  let base: string;
  let host: string;

  const panel = <T>(
    session: Session,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path = '',
    payload?: object,
  ) => api.call<T>(method, `/stores/${session.storeId}/domain${path}`, session, payload);

  const platform = <T>(method: 'GET' | 'PUT' | 'PATCH', path: string, payload?: object) =>
    api.call<T>(method, `/platform${path}`, admin, payload);

  beforeAll(async () => {
    api = await startTestApp();

    owner = await api.register('dominio-duena', 'pro');
    rival = await api.register('dominio-rival', 'pro');
    basic = await api.register('dominio-basica', 'basico');
    admin = await api.register('dominio-admin');

    const personal = await api.register('dominio-personal');

    await api.withOwner(async (client) => {
      await client.query(
        `insert into platform_admins (user_id) select id from users where email = $1`,
        [admin.email],
      );
      await client.query(
        `insert into store_members (store_id, user_id, role)
         select $1, id, 'STAFF' from users where email = $2`,
        [owner.storeId, personal.email],
      );
    });

    // El personal entra a la tienda de la dueña con `switch-store`, como en la app.
    const switched = await api.call<{ accessToken: string; refreshToken: string }>(
      'POST',
      '/auth/switch-store',
      personal,
      { storeId: owner.storeId, refreshToken: personal.refreshToken },
    );

    staff = {
      token: switched.body.accessToken,
      refreshToken: switched.body.refreshToken,
      storeId: owner.storeId,
      slug: owner.slug,
      email: personal.email,
    };

    base = uniqueBase('mitienda');
    host = `www.${base}`;
  });

  afterAll(async () => {
    await api.close();
  });

  describe('el panel de la dueña', () => {
    it('sin dominio, el plan lo permite y no hay nada que mostrar', async () => {
      const { status, body } = await panel<DomainState>(owner, 'GET');

      expect(status).toBe(200);
      expect(body).toEqual({ allowed: true, domain: null });
    });

    it('una tienda sin plan con dominio propio no puede ponerlo', async () => {
      const { status, body } = await api.call<{ message: string }>(
        'PUT',
        `/stores/${basic.storeId}/domain`,
        basic,
        { host },
      );

      expect(status).toBe(403);
      expect(body.message).toBe('Tu plan no incluye dominio propio.');
    });

    it('rechaza hosts inválidos, reservados y direcciones IP', async () => {
      for (const bad of ['127.0.0.1', 'localhost', 'mitienda', 'proyecto.vercel.app']) {
        const { status } = await panel(owner, 'PUT', '', { host: bad });

        expect(status).toBe(400);
      }
    });

    it('solo la dueña ve y cambia el dominio: el personal recibe 403', async () => {
      expect((await panel(staff, 'GET')).status).toBe(403);
      expect((await panel(staff, 'PUT', '', { host })).status).toBe(403);
      expect((await panel(staff, 'DELETE')).status).toBe(403);
    });

    it('poner el dominio lo deja pendiente con los registros DNS que faltan', async () => {
      const { status, body } = await panel<DomainBody>(owner, 'PUT', '', { host });

      expect(status).toBe(200);
      expect(body.host).toBe(host);
      expect(body.status).toBe('pending');
      expect(body.verifiedAt).toBeNull();
      expect(body.lastError).toEqual(expect.any(String));

      // Un subdominio: CNAME de `www` al destino de Vercel y el TXT de propiedad.
      expect(body.dnsRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'CNAME', name: 'www' }),
          expect.objectContaining({ type: 'TXT', name: '_globerce.www' }),
        ]),
      );
      const txt = body.dnsRecords.find((record) => record.type === 'TXT');

      expect(txt?.value).toMatch(/^globerce-verify=[0-9a-f]{48}$/);
    });

    it('mientras el dominio está pendiente, la tienda sigue en su subdominio', async () => {
      const storefront = await api.call<StorefrontBody>('GET', `/public/${owner.slug}`);
      const settings = await api.call<SettingsBody>(
        'GET',
        `/stores/${owner.storeId}/settings`,
        owner,
      );

      expect(storefront.body.store.publicUrl).toContain(`${owner.slug}.`);
      expect(settings.body.publicUrl).toBe(storefront.body.store.publicUrl);
    });

    it('verificar con el DNS bien lo pasa a activo', async () => {
      const { status, body } = await panel<DomainBody>(owner, 'POST', '/verify');

      expect(status).toBe(200);
      expect(body.status).toBe('active');
      expect(body.verifiedAt).toEqual(expect.any(String));
      expect(body.lastError).toBeNull();
    });

    it('con el dominio activo, publicUrl cambia en la tienda, los ajustes y la plataforma', async () => {
      const storefront = await api.call<StorefrontBody>('GET', `/public/${owner.slug}`);
      const settings = await api.call<SettingsBody>(
        'GET',
        `/stores/${owner.storeId}/settings`,
        owner,
      );
      const detail = await platform<PlatformDetailBody>('GET', `/stores/${owner.storeId}`);

      expect(storefront.body.store.publicUrl).toBe(`https://${host}`);
      expect(settings.body.publicUrl).toBe(`https://${host}`);
      expect(detail.body.publicUrl).toBe(`https://${host}`);
      expect(detail.body.customDomainStatus).toBe('active');
    });

    it('el PATCH de ajustes también devuelve publicUrl', async () => {
      const { status, body } = await api.call<SettingsBody>(
        'PATCH',
        `/stores/${owner.storeId}/settings`,
        owner,
        { storeName: 'Tienda con dominio' },
      );

      expect(status).toBe(200);
      expect(body.publicUrl).toBe(`https://${host}`);
    });
  });

  describe('la resolución pública del host', () => {
    it('devuelve la tienda y su estado, normalizando mayúsculas, puerto y punto final', async () => {
      const plain = await api.call<PublicDomainBody>('GET', `/store-domains/${host}`);
      const messy = await api.call<PublicDomainBody>(
        'GET',
        `/store-domains/${host.toUpperCase()}:443.`,
      );

      expect(plain.body).toEqual({ slug: owner.slug, status: 'active' });
      expect(messy.body).toEqual(plain.body);
    });

    it('un host que nadie registró responde 404', async () => {
      const { status, body } = await api.call<{ message: string }>(
        'GET',
        `/store-domains/nadie-${randomBytes(3).toString('hex')}.com`,
      );

      expect(status).toBe(404);
      expect(body.message).toBe('Esta tienda no existe.');
    });

    it('una tienda suspendida no se resuelve: 404, no 403', async () => {
      // La tienda de la rival (plan pro) sirve aquí: registrar otra cuenta choca con el límite de registros.
      const suspendedHost = `www.${uniqueBase('suspendida')}`;

      await api.call('PUT', `/stores/${rival.storeId}/domain`, rival, { host: suspendedHost });
      await api.call('POST', `/stores/${rival.storeId}/domain/verify`, rival);

      expect((await api.call('GET', `/store-domains/${suspendedHost}`)).status).toBe(200);

      await platform('PATCH', `/stores/${rival.storeId}/status`, { status: 'SUSPENDED' });

      expect((await api.call('GET', `/store-domains/${suspendedHost}`)).status).toBe(404);

      await platform('PATCH', `/stores/${rival.storeId}/status`, { status: 'ACTIVE' });
      await api.call('DELETE', `/stores/${rival.storeId}/domain`, rival);
    });
  });

  describe('cambiar, quitar y perder el plan', () => {
    it('reemplazar el dominio quita el anterior y el nuevo queda pendiente', async () => {
      const pendingHost = `pendiente.${base}`;
      const { status, body } = await panel<DomainBody>(owner, 'PUT', '', { host: pendingHost });

      expect(status).toBe(200);
      expect(body.host).toBe(pendingHost);
      expect(body.status).toBe('pending');

      expect((await api.call('GET', `/store-domains/${host}`)).status).toBe(404);
    });

    it('un host pendiente de DNS no se verifica: queda pending con lastError', async () => {
      const { body } = await panel<DomainBody>(owner, 'POST', '/verify');

      expect(body.status).toBe('pending');
      expect(body.lastError).toEqual(expect.any(String));
      expect(body.verifiedAt).toBeNull();
    });

    it('volver al host bueno y verificarlo lo deja activo otra vez', async () => {
      await panel(owner, 'PUT', '', { host });
      const { body } = await panel<DomainBody>(owner, 'POST', '/verify');

      expect(body.status).toBe('active');
      expect(body.lastError).toBeNull();
    });

    it('si el plan deja de incluir dominio, el dominio queda disabled y la tienda vuelve al subdominio', async () => {
      const { status } = await platform('PUT', `/stores/${owner.storeId}/plan`, {
        planCode: 'basico',
      });

      expect(status).toBe(200);

      const state = await panel<DomainState>(owner, 'GET');

      expect(state.body.allowed).toBe(false);
      expect(state.body.domain?.status).toBe('disabled');

      const resolved = await api.call<PublicDomainBody>('GET', `/store-domains/${host}`);

      expect(resolved.body.status).toBe('disabled');

      const storefront = await api.call<StorefrontBody>('GET', `/public/${owner.slug}`);

      expect(storefront.body.store.publicUrl).toContain(`${owner.slug}.`);
      expect((await panel(owner, 'PUT', '', { host: `otro.${base}` })).status).toBe(403);
    });

    it('quitar el dominio funciona aunque el plan ya no lo incluya, y libera el host', async () => {
      const removed = await panel(owner, 'DELETE');

      expect(removed.status).toBe(204);

      const state = await panel<DomainState>(owner, 'GET');

      expect(state.body.domain).toBeNull();
      expect((await api.call('GET', `/store-domains/${host}`)).status).toBe(404);

      // La otra tienda puede tomar el host que acaba de quedar libre.
      const taken = await api.call<DomainBody>('PUT', `/stores/${rival.storeId}/domain`, rival, {
        host,
      });

      expect(taken.status).toBe(200);

      expect((await api.call('DELETE', `/stores/${rival.storeId}/domain`, rival)).status).toBe(204);
    });

    it('un host que ya usa otra tienda responde 409', async () => {
      // La dueña bajó de plan en el paso anterior: lo vuelve a subir para tener el dominio.
      await platform('PUT', `/stores/${owner.storeId}/plan`, { planCode: 'pro' });
      await panel(owner, 'PUT', '', { host });

      const { status, body } = await api.call<{ message: string }>(
        'PUT',
        `/stores/${rival.storeId}/domain`,
        rival,
        { host },
      );

      expect(status).toBe(409);
      expect(body.message).toBe('Ese dominio ya lo usa otra tienda.');

      await panel(owner, 'DELETE');
    });
  });
});
