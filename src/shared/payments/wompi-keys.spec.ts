import { checkWompiKeys, fetchMerchant, wompiModeOf } from './wompi-keys';
import { WompiGateway } from './wompi-gateway';

/**
 * Wompi no se llama de verdad en las pruebas: `fetch` se sustituye por una
 * respuesta fija, y se mira a qué URL y con qué header se pidió.
 */

const respuestaComercio = {
  data: {
    name: 'Tienda Mariposa',
    legal_name: 'Kevin Martínez E',
    email: 'dueña@example.com',
    phone_number: '3000000000',
    legal_id: '123',
    contact_name: 'Kevin',
    presigned_acceptance: {
      acceptance_token: 'acepto-firmado',
      permalink: 'https://wompi.co/terminos.pdf',
    },
  },
};

interface Llamada {
  url: string;
  headers: Record<string, string>;
}

function fetchFalso(respuesta: { status: number; body?: unknown } | 'red-caida') {
  const llamadas: Llamada[] = [];

  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;

    llamadas.push({ url, headers });

    if (respuesta === 'red-caida') return Promise.reject(new TypeError('fetch failed'));

    return Promise.resolve({
      ok: respuesta.status < 400,
      status: respuesta.status,
      json: () => Promise.resolve(respuesta.body ?? null),
      text: () => Promise.resolve(JSON.stringify(respuesta.body ?? null)),
    } as Response);
  }) as typeof fetch;

  return llamadas;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('wompiModeOf', () => {
  it('lee el mundo de la llave por su prefijo', () => {
    expect(wompiModeOf('pub_test_abc')).toBe('test');
    expect(wompiModeOf('prv_prod_abc')).toBe('prod');
    expect(wompiModeOf('pub_otra_cosa')).toBeNull();
  });
});

describe('fetchMerchant', () => {
  it('pide /merchants/info a sandbox con la llave de pruebas en el header', async () => {
    const llamadas = fetchFalso({ status: 200, body: respuestaComercio });

    await fetchMerchant('pub_test_llave');

    expect(llamadas[0]?.url).toBe('https://sandbox.wompi.co/v1/merchants/info');
    expect(llamadas[0]?.headers['x-merchant-public-key']).toBe('pub_test_llave');
  });

  it('usa producción para una llave pub_prod_', async () => {
    const llamadas = fetchFalso({ status: 200, body: respuestaComercio });

    await fetchMerchant('pub_prod_llave');

    expect(llamadas[0]?.url).toBe('https://production.wompi.co/v1/merchants/info');
  });

  it('solo guarda el nombre comercial, el token y los términos', async () => {
    fetchFalso({ status: 200, body: respuestaComercio });

    const result = await fetchMerchant('pub_test_llave');

    expect(result).toEqual({
      ok: true,
      merchant: {
        name: 'Tienda Mariposa',
        acceptanceToken: 'acepto-firmado',
        termsUrl: 'https://wompi.co/terminos.pdf',
      },
    });
  });

  it('una llave que Wompi no reconoce es rejected', async () => {
    fetchFalso({ status: 401, body: { error: 'no' } });

    expect(await fetchMerchant('pub_test_mala')).toEqual({ ok: false, reason: 'rejected' });
  });

  it('un fallo de red es unreachable', async () => {
    fetchFalso('red-caida');

    expect(await fetchMerchant('pub_test_llave')).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('checkWompiKeys', () => {
  it('con las dos llaves del mismo mundo, devuelve el modo y el nombre', async () => {
    fetchFalso({ status: 200, body: respuestaComercio });

    expect(await checkWompiKeys('pub_test_llave', 'prv_test_llave')).toEqual({
      ok: true,
      mode: 'test',
      merchantName: 'Tienda Mariposa',
    });
  });

  it('mezclar pruebas con producción se rechaza sin llamar a Wompi', async () => {
    const llamadas = fetchFalso({ status: 200, body: respuestaComercio });

    expect(await checkWompiKeys('pub_test_llave', 'prv_prod_llave')).toEqual({
      ok: false,
      reason: 'mixed',
    });
    expect(llamadas).toHaveLength(0);
  });
});

const credencialesTest = {
  publicKey: 'pub_test_llave',
  privateKey: 'prv_test_llave',
  integritySecret: 'test_integrity_secreto',
  eventsSecret: 'test_events_secreto',
};

const credencialesProd = {
  publicKey: 'pub_prod_llave',
  privateKey: 'prv_prod_llave',
  integritySecret: 'prod_integrity_secreto',
  eventsSecret: 'prod_events_secreto',
};

describe('WompiGateway.setup', () => {
  it('saca el acceptance token de /merchants/info, no de la ruta vieja', async () => {
    const llamadas = fetchFalso({ status: 200, body: respuestaComercio });
    const gateway = new WompiGateway('https://checkout.wompi.co/p/', credencialesTest);

    const setup = await gateway.setup();

    expect(setup.acceptanceToken).toBe('acepto-firmado');
    expect(setup.termsUrl).toBe('https://wompi.co/terminos.pdf');
    expect(llamadas[0]?.url).toBe('https://sandbox.wompi.co/v1/merchants/info');
    expect(llamadas.some((llamada) => llamada.url.includes('/merchants/pub_'))).toBe(false);
  });

  it('tokeniza en el entorno de su llave, por prefijo', async () => {
    fetchFalso({ status: 200, body: respuestaComercio });
    const gateway = new WompiGateway('https://checkout.wompi.co/p/', credencialesProd);

    const setup = await gateway.setup();

    expect(setup.apiUrl).toBe('https://production.wompi.co/v1');
  });
});

describe('cada llamada de WompiGateway va al entorno de su llave', () => {
  const origen = { reference: 'sub-1', amountCop: 49000, description: 'Plan' };

  it('createPaymentSource con llave de pruebas va a sandbox', async () => {
    const llamadas = fetchFalso({ status: 201, body: { data: { id: 7 } } });
    const gateway = new WompiGateway('https://checkout.wompi.co/p/');

    await gateway.createPaymentSource(
      { cardToken: 'tok_test_1', acceptanceToken: 'acepto', customerEmail: 'a@b.co' },
      credencialesTest,
    );

    expect(llamadas[0]?.url).toBe('https://sandbox.wompi.co/v1/payment_sources');
  });

  it('createPaymentSource con llave de producción va a producción', async () => {
    const llamadas = fetchFalso({ status: 201, body: { data: { id: 7 } } });
    const gateway = new WompiGateway('https://checkout.wompi.co/p/');

    await gateway.createPaymentSource(
      { cardToken: 'tok_prod_1', acceptanceToken: 'acepto', customerEmail: 'a@b.co' },
      credencialesProd,
    );

    expect(llamadas[0]?.url).toBe('https://production.wompi.co/v1/payment_sources');
  });

  it('charge con llave de pruebas va a sandbox y con la de producción a producción', async () => {
    const llamadas = fetchFalso({
      status: 201,
      body: { data: { id: 'tx-1', status: 'APPROVED' } },
    });
    const gateway = new WompiGateway('https://checkout.wompi.co/p/');
    const cobro = { ...origen, customerEmail: 'a@b.co', paymentSourceId: '7' };

    await gateway.charge(cobro, credencialesTest);
    await gateway.charge(cobro, credencialesProd);

    expect(llamadas[0]?.url).toBe('https://sandbox.wompi.co/v1/transactions');
    expect(llamadas[1]?.url).toBe('https://production.wompi.co/v1/transactions');
  });
});
