import { Method, Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Pedidos de punta a punta: lo que reemplaza a `create_order`, `cancel_order`,
 * `validate_coupon` y `mark_whatsapp_opened` de la versión con Supabase.
 *
 * Lo que más importa acá es el stock: que nunca se venda lo que no hay, que dos
 * pedidos simultáneos no se lleven la misma unidad, que un doble envío no
 * descuente dos veces y que cancelar devuelva lo descontado una sola vez.
 */

jest.setTimeout(60_000);

interface Created {
  id: string;
  number: number;
  token: string;
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
}

interface ErrorBody {
  message: string;
  error: string;
  details?: unknown;
}

interface OrderSummary {
  id: string;
  number: number;
  status: string;
  total: number;
}

const NO_SUCH_UUID = '00000000-0000-4000-8000-000000000000';

describe('Pedidos y comercio (e2e)', () => {
  let api: TestApp;
  let shop: Session;
  let other: Session;
  let zoneId: string;
  let pausedZoneId: string;
  let variantM: string;
  let variantS: string;

  const panel = <T>(method: Method, url: string, payload?: object, session: Session = shop) =>
    api.call<T>(method, `/stores/${session.storeId}${url}`, session, payload);

  const pub = <T>(
    method: Method,
    url: string,
    payload?: object,
    headers?: Record<string, string>,
  ) => api.call<T>(method, `/public/${shop.slug}${url}`, undefined, payload, headers);

  const customer = { name: 'Ana Gómez', phone: '300 123 4567', city: 'Bogotá' };

  const order = (
    items: { variantId: string; qty: number }[],
    extra: object = {},
    headers?: Record<string, string>,
  ) =>
    pub<Created & ErrorBody>(
      'POST',
      '/orders',
      { customer, shippingZoneId: zoneId, items, ...extra },
      headers,
    );

  const stockOf = async (variantId: string): Promise<number | undefined> => {
    const { body } = await panel<{ groups: { variants: { id: string; stock: number }[] }[] }>(
      'GET',
      '/inventory',
    );

    return body.groups.flatMap((group) => group.variants).find((v) => v.id === variantId)?.stock;
  };

  const couponUses = async (code: string): Promise<number | undefined> => {
    const { body } = await panel<{ code: string; uses: number }[]>('GET', '/coupons');

    return body.find((coupon) => coupon.code === code)?.uses;
  };

  beforeAll(async () => {
    api = await startTestApp();
    shop = await api.register('orders');
    other = await api.register('orders-other');

    zoneId = (
      await panel<{ id: string }>('POST', '/shipping-zones', {
        name: 'Bogotá',
        cost: 8000,
        etaDays: 2,
      })
    ).body.id;

    pausedZoneId = (
      await panel<{ id: string }>('POST', '/shipping-zones', {
        name: 'Pausada',
        cost: 5000,
        active: false,
      })
    ).body.id;

    const product = await api.seedProduct(
      shop,
      { name: 'Vestido Pedido', basePrice: 100000, status: 'ACTIVE' },
      [
        { name: 'Color', values: [{ value: 'Negro', hex: '#000000' }] },
        { name: 'Talla', values: [{ value: 'S' }, { value: 'M' }] },
      ],
      0,
    );

    variantM = product.variants.find((v) => v.label.endsWith('M'))?.id ?? '';
    variantS = product.variants.find((v) => v.label.endsWith('S'))?.id ?? '';

    await panel('PATCH', `/variants/${variantM}`, { stock: 3 });
    await panel('PATCH', `/variants/${variantS}`, { stock: 1, priceOverride: 120000 });

    await panel('POST', '/coupons', { code: 'bienvenida10', type: 'PERCENT', value: 10 });
    await panel('POST', '/coupons', {
      code: 'MIN500',
      type: 'FIXED',
      value: 20000,
      minSubtotal: 500000,
    });
    await panel('POST', '/coupons', { code: 'UNICO', type: 'FIXED', value: 5000, maxUses: 1 });
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('cotización', () => {
    it('solo ofrece zonas activas', async () => {
      const { body } = await pub<{ id: string }[]>('GET', '/shipping-zones');

      expect(body.map((zone) => zone.id)).toEqual([zoneId]);
    });

    it('precia desde la base, recorta al stock y avisa lo que ya no existe', async () => {
      const { status, body } = await pub<{
        lines: { variantId: string; qty: number; unitPrice: number; adjustedFrom: number | null }[];
        removed: { variantId: string; label: string }[];
        totals: { subtotal: number; discount: number; shippingCost: number; total: number };
      }>('POST', '/cart/quote', {
        items: [
          { variantId: variantM, qty: 5 },
          { variantId: variantS, qty: 1 },
          { variantId: NO_SUCH_UUID, qty: 1 },
        ],
        couponCode: 'bienvenida10',
        shippingZoneId: zoneId,
      });

      expect(status).toBe(200);
      expect(body.lines).toEqual([
        expect.objectContaining({
          variantId: variantM,
          qty: 3,
          unitPrice: 100000,
          adjustedFrom: 5,
        }),
        expect.objectContaining({
          variantId: variantS,
          qty: 1,
          unitPrice: 120000,
          adjustedFrom: null,
        }),
      ]);
      expect(body.removed).toEqual([{ variantId: NO_SUCH_UUID, label: 'Prenda no disponible' }]);
      // 3 × 100.000 + 120.000 = 420.000; 10 % = 42.000; más 8.000 de envío.
      expect(body.totals).toEqual({
        subtotal: 420000,
        discount: 42000,
        shippingCost: 8000,
        total: 386000,
      });
    });

    it('explica por qué un cupón no aplica', async () => {
      const { body } = await pub<{ coupon: unknown; couponRejection: string | null }>(
        'POST',
        '/cart/quote',
        { items: [{ variantId: variantM, qty: 1 }], couponCode: 'MIN500' },
      );

      expect(body).toMatchObject({ coupon: null, couponRejection: 'min_subtotal' });
    });
  });

  describe('crear pedido', () => {
    let first: Created;

    it('descuenta stock, usa el cupón y numera desde 1', async () => {
      const { status, body } = await order([{ variantId: variantM, qty: 2 }], {
        couponCode: 'BIENVENIDA10',
      });

      expect(status).toBe(201);
      expect(body).toMatchObject({
        number: 1,
        subtotal: 200000,
        discount: 20000,
        shippingCost: 8000,
        total: 188000,
      });
      expect(await stockOf(variantM)).toBe(1);
      expect(await couponUses('BIENVENIDA10')).toBe(1);

      first = body;
    });

    it('sin stock suficiente responde 409 con el detalle y no toca nada', async () => {
      const { status, body } = await order([{ variantId: variantM, qty: 2 }]);

      expect(status).toBe(409);
      expect(body.error).toBe('out_of_stock');
      expect(body.details).toEqual([
        expect.objectContaining({ variantId: variantM, requested: 2, available: 1 }),
      ]);
      expect(await stockOf(variantM)).toBe(1);
    });

    it('dos pedidos simultáneos por la última unidad: uno gana y el otro recibe 409', async () => {
      const results = await Promise.all([
        order([{ variantId: variantS, qty: 1 }]),
        order([{ variantId: variantS, qty: 1 }]),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await stockOf(variantS)).toBe(0);
    });

    it('la misma clave de idempotencia devuelve el mismo pedido y descuenta una sola vez', async () => {
      await panel('PATCH', `/variants/${variantM}`, { stock: 5 });

      const headers = { 'idempotency-key': 'carrito-ana-000123' };
      const [a, b] = await Promise.all([
        order([{ variantId: variantM, qty: 1 }], {}, headers),
        order([{ variantId: variantM, qty: 1 }], {}, headers),
      ]);
      const c = await order([{ variantId: variantM, qty: 1 }], {}, headers);

      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
      expect(new Set([a.body.number, b.body.number, c.body.number]).size).toBe(1);
      expect(await stockOf(variantM)).toBe(4);
    });

    it('un cupón agotado se rechaza sin descontar stock', async () => {
      expect((await order([{ variantId: variantM, qty: 1 }], { couponCode: 'UNICO' })).status).toBe(
        201,
      );

      const before = await stockOf(variantM);
      const { status, body } = await order([{ variantId: variantM, qty: 1 }], {
        couponCode: 'unico',
      });

      expect(status).toBe(400);
      expect(body).toMatchObject({ error: 'coupon_rejected', details: { reason: 'exhausted' } });
      expect(await stockOf(variantM)).toBe(before);
    });

    it('una zona pausada no se acepta', async () => {
      const { status, body } = await order([{ variantId: variantM, qty: 1 }], {
        shippingZoneId: pausedZoneId,
      });

      expect(status).toBe(400);
      expect(body.error).toBe('invalid_zone');
    });

    it('el envío es gratis al alcanzar el umbral', async () => {
      await panel('PATCH', '/settings', { freeShippingThreshold: 200000 });

      const { body } = await order([{ variantId: variantM, qty: 2 }]);

      expect(body).toMatchObject({ subtotal: 200000, shippingCost: 0, total: 200000 });

      await panel('PATCH', '/settings', { freeShippingThreshold: null });
    });

    it('la clienta ve su pedido solo con el token del enlace', async () => {
      const seen = await pub<{ items: unknown[] }>(
        'GET',
        `/orders/${first.number}?token=${first.token}`,
      );

      expect(seen.status).toBe(200);
      expect(seen.body.items).toHaveLength(1);
      expect(seen.body).not.toHaveProperty('adminNotes');

      expect((await pub('GET', `/orders/${first.number}?token=${NO_SUCH_UUID}`)).status).toBe(404);
      expect(
        (await api.call('GET', `/public/${other.slug}/orders/${first.number}?token=${first.token}`))
          .status,
      ).toBe(404);

      expect(
        (await pub('POST', `/orders/${first.number}/whatsapp-opened`, { token: first.token }))
          .status,
      ).toBe(204);

      const opened = await pub<{ whatsappOpenedAt: string | null }>(
        'GET',
        `/orders/${first.number}?token=${first.token}`,
      );

      expect(opened.body.whatsappOpenedAt).not.toBeNull();
    });
  });

  describe('pedidos en el panel', () => {
    it('lista, filtra por estado y busca por número o por nombre', async () => {
      const all = await panel<{ orders: OrderSummary[]; total: number }>('GET', '/orders');

      expect(all.status).toBe(200);
      expect(all.body.total).toBe(5);
      expect(
        (await panel<{ orders: OrderSummary[] }>('GET', '/orders?q=%231')).body.orders.map(
          (o) => o.number,
        ),
      ).toEqual([1]);
      expect((await panel<{ total: number }>('GET', '/orders?q=ana')).body.total).toBe(5);
      expect((await panel<{ total: number }>('GET', '/orders?status=PENDING')).body.total).toBe(5);
    });

    it('cancelar devuelve stock y cupón una sola vez, y un cancelado no se reabre', async () => {
      const found = (await panel<OrderSummary>('GET', '/orders/number/1')).body;
      const stockBefore = (await stockOf(variantM)) ?? 0;

      const cancelled = await panel<{ status: string }>('PATCH', `/orders/${found.id}`, {
        status: 'CANCELLED',
      });

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(await stockOf(variantM)).toBe(stockBefore + 2);
      expect(await couponUses('BIENVENIDA10')).toBe(0);

      await panel('PATCH', `/orders/${found.id}`, { status: 'CANCELLED' });

      expect(await stockOf(variantM)).toBe(stockBefore + 2);
      expect((await panel('PATCH', `/orders/${found.id}`, { status: 'PENDING' })).status).toBe(409);

      const noted = await panel<{ adminNotes: string | null }>('PATCH', `/orders/${found.id}`, {
        adminNotes: 'Llamar antes de enviar',
      });

      expect(noted.body.adminNotes).toBe('Llamar antes de enviar');
    });

    it('otra tienda no ve ni puede nombrar estos pedidos', async () => {
      const found = (await panel<OrderSummary>('GET', '/orders/number/2')).body;

      expect((await api.call('GET', `/stores/${shop.storeId}/orders`, other)).status).toBe(403);
      expect((await panel('GET', `/orders/${found.id}`, undefined, other)).status).toBe(404);
    });
  });

  describe('resumen y avisos', () => {
    it('cuenta pendientes, ventas del mes, stock bajo y avisos', async () => {
      expect(
        (
          await api.call('POST', `/public/${shop.slug}/restock-requests`, undefined, {
            variantId: variantS,
            contact: '3001234567',
          })
        ).status,
      ).toBe(204);

      const orders = (await panel<{ orders: OrderSummary[] }>('GET', '/orders')).body.orders;
      const live = orders.filter((o) => o.status !== 'CANCELLED');

      const { body } = await panel<{
        pendingOrders: number;
        monthOrders: number;
        monthRevenue: number;
        lowStock: { variantId: string }[];
        pendingRestock: number;
      }>('GET', '/dashboard');

      expect(body.pendingOrders).toBe(live.length);
      expect(body.monthOrders).toBe(live.length);
      expect(body.monthRevenue).toBe(live.reduce((sum, o) => sum + o.total, 0));
      expect(body.lowStock.map((v) => v.variantId)).toEqual(expect.arrayContaining([variantS]));
      expect(body.pendingRestock).toBe(1);
    });

    it('marcar un aviso como enviado lo saca de pendientes', async () => {
      const list = await panel<{ id: string; productName: string; stock: number }[]>(
        'GET',
        '/restock-requests',
      );

      expect(list.body[0]).toMatchObject({ productName: 'Vestido Pedido', stock: 0 });

      await panel('PATCH', `/restock-requests/${list.body[0]?.id}`, { notified: true });

      expect(
        (await panel<{ pendingRestock: number }>('GET', '/dashboard')).body.pendingRestock,
      ).toBe(0);
    });
  });

  describe('cupones y zonas en el panel', () => {
    it('valida cupones: código repetido, porcentaje y fechas', async () => {
      expect(
        (await panel('POST', '/coupons', { code: 'BIENVENIDA10', type: 'FIXED', value: 1000 }))
          .status,
      ).toBe(409);
      expect(
        (await panel('POST', '/coupons', { code: 'MUCHO', type: 'PERCENT', value: 150 })).status,
      ).toBe(400);
      expect(
        (
          await panel('POST', '/coupons', {
            code: 'FECHAS',
            type: 'FIXED',
            value: 1000,
            startsAt: '2026-10-02T00:00:00-05:00',
            endsAt: '2026-10-01T00:00:00-05:00',
          })
        ).status,
      ).toBe(400);
    });

    it('un cupón usado se desactiva al borrarlo; uno sin usar se borra', async () => {
      const coupons = (await panel<{ id: string; code: string }[]>('GET', '/coupons')).body;
      const used = coupons.find((c) => c.code === 'UNICO');
      const unused = coupons.find((c) => c.code === 'MIN500');

      expect((await panel('DELETE', `/coupons/${used?.id}`)).body).toEqual({
        result: 'deactivated',
      });
      expect((await panel('DELETE', `/coupons/${unused?.id}`)).body).toEqual({ result: 'deleted' });
    });

    it('una zona usada se desactiva al borrarla; una sin usar se borra', async () => {
      expect((await panel('DELETE', `/shipping-zones/${zoneId}`)).body).toEqual({
        result: 'deactivated',
      });
      expect((await panel('DELETE', `/shipping-zones/${pausedZoneId}`)).body).toEqual({
        result: 'deleted',
      });
    });
  });
});
