import type { Session, TestApp } from './utils/test-app';

/**
 * El cobro como sale de fábrica: sin pasarela.
 *
 * Con `PAYMENTS_DRIVER=none` —el valor por defecto— la tienda no puede pagar
 * sola: los pagos los registra la plataforma desde su consola. Va en su propio
 * archivo, y no junto al resto, porque el entorno se fija antes de importar
 * `AppModule` y `ConfigModule` no vuelve a mirarlo; el `.env` de la máquina,
 * que puede tener otro valor, no decide lo que prueba esta suite.
 */
process.env.PAYMENTS_DRIVER = 'none';

jest.setTimeout(60_000);

interface Summary {
  plan: { code: string };
  selfServiceBilling: boolean;
  payments: unknown[];
}

describe('Cobro sin pasarela (e2e)', () => {
  let api: TestApp;
  let shop: Session;

  beforeAll(async () => {
    const { startTestApp } = await import('./utils/test-app');

    api = await startTestApp();
    shop = await api.register('pagos-manual');
  });

  afterAll(async () => {
    await api?.close();
  });

  it('el panel sabe que acá no se paga en línea', async () => {
    const { status, body } = await api.call<Summary>(
      'GET',
      `/stores/${shop.storeId}/subscription`,
      shop,
    );

    expect(status).toBe(200);
    expect(body.selfServiceBilling).toBe(false);
  });

  it('empezar un cobro se rechaza y no deja ningún pago', async () => {
    const { status, body } = await api.call<{ message: string }>(
      'POST',
      `/stores/${shop.storeId}/subscription/checkout`,
      shop,
      { planCode: 'pro' },
    );

    expect(status).toBe(400);
    expect(body.message).toContain('no están disponibles');

    const summary = await api.call<Summary>('GET', `/stores/${shop.storeId}/subscription`, shop);

    expect(summary.body.plan.code).toBe('basico');
    expect(summary.body.payments).toEqual([]);
  });

  it('sin pasarela, un evento de pago no se atiende', async () => {
    // Nadie debería estar mandando eventos si no hay con qué cobrar.
    const { status } = await api.call('POST', '/payments/events', undefined, {
      reference: 'sub-lo-que-sea',
      amountCop: 99000,
    });

    expect(status).toBe(401);
  });
});
