import { randomBytes } from 'node:crypto';

import { DomainCheckService } from '../src/modules/domains/providers/domain-check.service';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * La revisión diaria de los dominios, de punta a punta, contra la base.
 *
 * Solo toca las dos tiendas de esta prueba (`storeIds`): la base de desarrollo
 * puede tener tiendas reales con dominio, y la tarea de verdad revisaría
 * todas. Por eso el liberado se prueba con una fecha futura y no con datos
 * viejos de verdad.
 */

jest.setTimeout(120_000);

const DAY_MS = 24 * 60 * 60 * 1000;

interface DomainBody {
  host: string;
  status: string;
}

describe('revisión diaria de dominios', () => {
  let api: TestApp;
  let pendiente: Session;
  let buena: Session;
  let base: string;
  let checker: DomainCheckService;

  beforeAll(async () => {
    api = await startTestApp();
    checker = api.get(DomainCheckService);

    pendiente = await api.register('chequeo-pendiente', 'pro');
    buena = await api.register('chequeo-buena', 'pro');

    base = `chequeo-${randomBytes(3).toString('hex')}.com`;

    // Un host que el driver log no verifica (empieza por `pendiente.`).
    await api.call('PUT', `/stores/${pendiente.storeId}/domain`, pendiente, {
      host: `pendiente.${base}`,
    });

    // Un host que sí se verifica, pero que nadie ha confirmado todavía.
    await api.call('PUT', `/stores/${buena.storeId}/domain`, buena, { host: `www.${base}` });
  });

  afterAll(async () => {
    await api.close();
  });

  it('activa el dominio que ya funciona y deja el que no, como pending', async () => {
    const summary = await checker.runDailyCheck({
      storeIds: [pendiente.storeId, buena.storeId],
    });

    expect(summary).toEqual({ checked: 2, activated: 1, failed: 0, released: 0, errors: 0 });

    const bien = await api.call<DomainBody>('GET', `/stores/${buena.storeId}/domain`, buena);
    const mal = await api.call<{ domain: DomainBody }>(
      'GET',
      `/stores/${pendiente.storeId}/domain`,
      pendiente,
    );

    expect(bien.body).toMatchObject({ domain: { status: 'active' } });
    expect(mal.body.domain).toMatchObject({ status: 'pending' });
  });

  it('un pending de más de 7 días se libera: sale de la tienda y del host', async () => {
    const enOchoDias = new Date(Date.now() + 8 * DAY_MS);

    const summary = await checker.runDailyCheck({
      now: enOchoDias,
      storeIds: [pendiente.storeId, buena.storeId],
    });

    expect(summary.released).toBe(1);
    expect(summary.failed).toBe(0);

    const state = await api.call<{ domain: DomainBody | null }>(
      'GET',
      `/stores/${pendiente.storeId}/domain`,
      pendiente,
    );

    expect(state.body.domain).toBeNull();
    expect((await api.call('GET', `/store-domains/pendiente.${base}`)).status).toBe(404);
  });

  it('un dominio activo y bien no cambia con la revisión', async () => {
    const enOchoDias = new Date(Date.now() + 8 * DAY_MS);

    await checker.runDailyCheck({ now: enOchoDias, storeIds: [buena.storeId] });

    const resolved = await api.call<{ status: string }>('GET', `/store-domains/www.${base}`);

    expect(resolved.body.status).toBe('active');
  });
});
