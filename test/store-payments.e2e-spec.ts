import type { Method, Session, TestApp } from './utils/test-app';

/**
 * Que cada tienda cobre sus pedidos en su propia cuenta.
 *
 * La plata de una venta es de la tienda, así que el cobro sale con SUS llaves
 * y Globerce no la toca. Lo que se prueba acá es eso: que las llaves se
 * guarden cifradas y no vuelvan nunca, que el monto salga del pedido y no de
 * la petición, y que lo que marca pagado sea el evento y no el navegador de
 * quien paga.
 *
 * Corre con la pasarela simulada; con Wompi cambia quién firma el evento, no
 * lo que pasa después.
 */
process.env.PAYMENTS_DRIVER = 'simulated';
process.env.PAYMENTS_SECRET = 'un secreto de plataforma para las pruebas';

jest.setTimeout(60_000);

interface Account {
  connected: boolean;
  publicKey: string | null;
  eventsUrl: string;
  privateKey?: string;
}

interface Link {
  url: string;
  reference: string;
  amountCop: number;
  message?: string;
}

interface OrderCreated {
  number: number;
  token: string;
  total: number;
}

interface PublicOrder {
  paymentStatus: string;
  paidAt: string | null;
  total: number;
}

const LLAVES = {
  publicKey: 'pub_test_llave_publica',
  privateKey: 'prv_test_llave_privada',
  integritySecret: 'secreto-de-integridad-de-prueba',
  eventsSecret: 'secreto-de-eventos-de-prueba',
};

describe('Pagos de la tienda (e2e)', () => {
  let api: TestApp;
  let shop: Session;
  let pedido: OrderCreated;
  let zonaId: string;
  let variantId: string;

  const panel = <T>(method: Method, url: string, payload?: object) =>
    api.call<T>(method, `/stores/${shop.storeId}${url}`, shop, payload);

  const pub = <T>(method: Method, url: string, payload?: object) =>
    api.call<T>(method, `/public/${shop.slug}${url}`, undefined, payload);

  const verPedido = () => pub<PublicOrder>('GET', `/orders/${pedido.number}?token=${pedido.token}`);

  /** Lo que hace la pasarela de la tienda cuando el pago se aprueba. */
  const avisar = (reference: string, amountCop: number) =>
    api.call('POST', `/payments/events/${shop.storeId}`, undefined, { reference, amountCop });

  /** Otro pedido igual al primero, para lo que no se puede probar dos veces. */
  const nuevoPedido = async (): Promise<OrderCreated> => {
    const creado = await pub<OrderCreated>('POST', '/orders', {
      customer: { name: 'Ana Gómez', phone: '3001234567', city: 'Bogotá' },
      shippingZoneId: zonaId,
      items: [{ variantId, qty: 1 }],
    });

    return creado.body;
  };

  beforeAll(async () => {
    const { startTestApp } = await import('./utils/test-app');

    api = await startTestApp();
    shop = await api.register('pagos-tienda');

    const zona = await panel<{ id: string }>('POST', '/shipping-zones', {
      name: 'Bogotá',
      cost: 8000,
    });

    const detalle = await api.seedProduct(
      shop,
      { name: 'Blusa de prueba', basePrice: 90000, status: 'ACTIVE' },
      [{ name: 'Variación', values: [{ value: 'M' }] }],
      5,
    );

    zonaId = zona.body.id;
    variantId = detalle.variants[0]?.id ?? '';

    const creado = await pub<OrderCreated>('POST', '/orders', {
      customer: { name: 'Ana Gómez', phone: '3001234567', city: 'Bogotá' },
      shippingZoneId: zonaId,
      items: [{ variantId, qty: 1 }],
    });

    if (creado.status !== 201) {
      throw new Error(
        `No se pudo preparar el pedido de prueba: ${creado.status} ${JSON.stringify(creado.body)}`,
      );
    }

    pedido = creado.body;
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('conectar la cuenta', () => {
    it('sin cuenta, la tienda no cobra en línea y lo dice', async () => {
      const vitrina = await pub<{ settings: { onlinePayments: boolean } }>('GET', '');

      expect(vitrina.body.settings.onlinePayments).toBe(false);

      const intento = await pub<Link>('POST', `/orders/${pedido.number}/checkout`, {
        token: pedido.token,
        redirectUrl: 'http://localhost:5173/pedido/1',
      });

      expect(intento.status).toBe(400);
    });

    it('las llaves se guardan cifradas y las secretas no vuelven', async () => {
      const { status, body } = await panel<Account>('PUT', '/payments', LLAVES);

      expect(status).toBe(200);
      expect(body.connected).toBe(true);
      // La pública sí: viaja en cada enlace de pago.
      expect(body.publicKey).toBe(LLAVES.publicKey);
      // Las secretas no salen de la API por ninguna puerta.
      expect(JSON.stringify(body)).not.toContain(LLAVES.privateKey);
      expect(JSON.stringify(body)).not.toContain(LLAVES.eventsSecret);
      expect(body.eventsUrl).toContain(shop.storeId);

      // Y en la base tampoco están en claro: un volcado robado no puede ser
      // también el robo de la cuenta de comercio de la tienda.
      const guardado = await api.withOwner(async (client) => {
        const { rows } = await client.query<{ private_key_sealed: string }>(
          'select private_key_sealed from store_payment_accounts where store_id = $1',
          [shop.storeId],
        );

        return rows[0]?.private_key_sealed ?? '';
      });

      expect(guardado).not.toContain(LLAVES.privateKey);
      expect(guardado.length).toBeGreaterThan(20);
    });

    it('con la cuenta puesta, la vitrina ofrece pagar en línea', async () => {
      const vitrina = await pub<{ settings: { onlinePayments: boolean } }>('GET', '');

      expect(vitrina.body.settings.onlinePayments).toBe(true);
    });
  });

  describe('cobrar un pedido', () => {
    it('el monto sale del pedido, no de la petición', async () => {
      const { status, body } = await pub<Link>('POST', `/orders/${pedido.number}/checkout`, {
        token: pedido.token,
        redirectUrl: 'http://localhost:5173/pedido/1',
      });

      expect(status).toBe(201);
      expect(body.amountCop).toBe(pedido.total);
      expect(body.reference).toContain('ord-');

      // Mientras no llegue el evento, el pedido no está pago.
      expect((await verPedido()).body.paymentStatus).toBe('PENDING');
    });

    it('sin el token del pedido no se puede cobrar', async () => {
      const { status } = await pub('POST', `/orders/${pedido.number}/checkout`, {
        token: '00000000-0000-4000-8000-000000000000',
        redirectUrl: 'http://localhost:5173/pedido/1',
      });

      expect(status).toBe(404);
    });

    it('la vuelta tiene que caer en una dirección nuestra', async () => {
      // Si no, quien arma el cobro elige a dónde va la clienta justo después
      // de escribir los datos de su tarjeta.
      const { status } = await pub('POST', `/orders/${pedido.number}/checkout`, {
        token: pedido.token,
        redirectUrl: 'https://sitio-de-otro.com/gracias',
      });

      expect(status).toBe(400);
    });
  });

  describe('el evento de la pasarela', () => {
    it('es lo que marca el pedido como pagado', async () => {
      const cobro = await pub<Link>('POST', `/orders/${pedido.number}/checkout`, {
        token: pedido.token,
        redirectUrl: 'http://localhost:5173/pedido/1',
      });

      await avisar(cobro.body.reference, cobro.body.amountCop);

      const { body } = await verPedido();

      expect(body.paymentStatus).toBe('PAID');
      expect(body.paidAt).not.toBeNull();
    });

    it('el mismo evento otra vez no cambia nada', async () => {
      const antes = (await verPedido()).body;
      const cobro = await pub<Link>('POST', `/orders/${pedido.number}/checkout`, {
        token: pedido.token,
        redirectUrl: 'http://localhost:5173/pedido/1',
      });

      // Las pasarelas reintentan: el mismo pago no puede volver a marcar nada.
      await avisar(cobro.body.reference, cobro.body.amountCop);

      expect((await verPedido()).body.paidAt).toBe(antes.paidAt);
    });

    it('un pago por menos del total no paga el pedido', async () => {
      const otro = await nuevoPedido();
      const cobro = await pub<Link>('POST', `/orders/${otro.number}/checkout`, {
        token: otro.token,
        redirectUrl: 'http://localhost:5173/pedido/2',
      });

      await avisar(cobro.body.reference, 1000);

      const { body } = await pub<PublicOrder>('GET', `/orders/${otro.number}?token=${otro.token}`);

      // Queda anotado como fallido para que la tienda lo vea y decida.
      expect(body.paymentStatus).toBe('FAILED');
      expect(body.paidAt).toBeNull();
    });
  });

  describe('desconectar', () => {
    it('deja de ofrecerse el pago en línea', async () => {
      const { body } = await panel<Account>('DELETE', '/payments');

      expect(body.connected).toBe(false);

      const vitrina = await pub<{ settings: { onlinePayments: boolean } }>('GET', '');

      expect(vitrina.body.settings.onlinePayments).toBe(false);
    });
  });
});
