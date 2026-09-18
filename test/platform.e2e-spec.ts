import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Plataforma de punta a punta: quién puede entrar, pagos, suspensión, planes
 * y sus límites, y lo que la tienda ve de su propia suscripción.
 */

jest.setTimeout(60_000);

interface StoreRow {
  id: string;
  slug: string;
  status: string;
  planCode: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  members: { email: string; role: string }[];
  productCount: number;
}

interface StoreDetail extends StoreRow {
  payments: { amountCop: number; periodEnd: string; recordedBy: string | null }[];
}

interface Summary {
  plan: { code: string; maxProducts: number | null };
  status: string;
  storeStatus: string;
  currentPeriodEnd: string;
  daysLeft: number;
  usage: { products: number; ordersThisMonth: number };
}

describe('Plataforma (e2e)', () => {
  let api: TestApp;
  let admin: Session;
  let shop: Session;

  const platform = <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    api.call<T>(method, `/platform${url}`, admin, payload);

  const panel = <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    api.call<T>(method, `/stores/${shop.storeId}${url}`, shop, payload);

  beforeAll(async () => {
    api = await startTestApp();
    admin = await api.register('platform-admin');
    shop = await api.register('platform-shop');

    // La única puerta a `platform_admins` es la base (ver scripts/grant-platform-admin.ts).
    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        admin.email,
      ]),
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('acceso', () => {
    it('una dueña común no entra a la plataforma', async () => {
      expect((await api.call('GET', '/platform/stores', shop)).status).toBe(403);
      expect((await api.call('GET', '/platform/stores')).status).toBe(401);
    });

    it('la administradora ve las tiendas con su plan y sus dueñas', async () => {
      const { status, body } = await platform<StoreRow[]>('GET', `/stores?q=${shop.slug}`);
      const row = body.find((store) => store.id === shop.storeId);

      expect(status).toBe(200);
      expect(row).toMatchObject({
        status: 'TRIAL',
        planCode: 'basico',
        subscriptionStatus: 'TRIALING',
        members: [{ email: shop.email, role: 'OWNER' }],
      });
      expect(row?.trialEndsAt).not.toBeNull();
    });

    it('busca por correo de la dueña', async () => {
      const { body } = await platform<StoreRow[]>('GET', `/stores?q=${shop.email}`);

      expect(body.map((store) => store.id)).toEqual([shop.storeId]);
    });
  });

  describe('pagos y estado', () => {
    it('registrar un pago activa la tienda, cierra la prueba y extiende el período', async () => {
      const { status, body } = await platform<StoreDetail>(
        'POST',
        `/stores/${shop.storeId}/payments`,
        {
          amountCop: 49000,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          method: 'nequi',
          reference: 'M123',
        },
      );

      expect(status).toBe(201);
      expect(body).toMatchObject({
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        currentPeriodEnd: '2026-10-31',
        trialEndsAt: null,
      });
      expect(body.payments).toEqual([
        expect.objectContaining({
          amountCop: 49000,
          periodEnd: '2026-10-31',
          recordedBy: admin.email,
        }),
      ]);
    });

    it('un pago con período anterior no acorta el vigente', async () => {
      const { body } = await platform<StoreDetail>('POST', `/stores/${shop.storeId}/payments`, {
        amountCop: 49000,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        method: 'efectivo',
      });

      expect(body.currentPeriodEnd).toBe('2026-10-31');
      expect(body.payments).toHaveLength(2);
    });

    it('rechaza un período al revés', async () => {
      const { status } = await platform('POST', `/stores/${shop.storeId}/payments`, {
        amountCop: 1000,
        periodStart: '2026-11-30',
        periodEnd: '2026-11-01',
        method: 'nequi',
      });

      expect(status).toBe(400);
    });

    it('suspender apaga la tienda pública y deja el panel en lectura', async () => {
      const suspended = await platform<StoreDetail>('PATCH', `/stores/${shop.storeId}/status`, {
        status: 'SUSPENDED',
      });

      expect(suspended.body.status).toBe('SUSPENDED');
      expect((await api.call('GET', `/public/${shop.slug}`)).status).toBe(404);
      expect((await panel('GET', '/products')).status).toBe(200);

      const blocked = await panel<{ error: string }>('POST', '/products', {
        name: 'Bloqueada',
        basePrice: 1000,
      });

      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('store_suspended');

      const reactivated = await platform<StoreDetail>('PATCH', `/stores/${shop.storeId}/status`, {
        status: 'ACTIVE',
      });

      expect(reactivated.body.status).toBe('ACTIVE');
      expect((await api.call('GET', `/public/${shop.slug}`)).status).toBe(200);
    });

    it('un pago no reactiva una tienda suspendida a mano', async () => {
      await platform('PATCH', `/stores/${shop.storeId}/status`, { status: 'SUSPENDED' });

      const { body } = await platform<StoreDetail>('POST', `/stores/${shop.storeId}/payments`, {
        amountCop: 49000,
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        method: 'nequi',
      });

      expect(body).toMatchObject({ status: 'SUSPENDED', currentPeriodEnd: '2026-11-30' });

      await platform('PATCH', `/stores/${shop.storeId}/status`, { status: 'ACTIVE' });
    });
  });

  describe('planes y límites', () => {
    afterAll(async () => {
      await api.withOwner((client) =>
        client.query(`update plans set max_products = 100 where code = 'basico'`),
      );
    });

    it('cambia de plan; uno inexistente es 400', async () => {
      expect(
        (await platform('PUT', `/stores/${shop.storeId}/plan`, { planCode: 'oro' })).status,
      ).toBe(400);

      const { body } = await platform<StoreDetail>('PUT', `/stores/${shop.storeId}/plan`, {
        planCode: 'pro',
        notes: 'Cortesía de lanzamiento',
      });

      expect(body.planCode).toBe('pro');

      await platform('PUT', `/stores/${shop.storeId}/plan`, { planCode: 'basico' });
    });

    it('el límite de prendas del plan se aplica al crear', async () => {
      await api.withOwner((client) =>
        client.query(`update plans set max_products = 1 where code = 'basico'`),
      );

      expect((await panel('POST', '/products', { name: 'Primera', basePrice: 1000 })).status).toBe(
        201,
      );

      const blocked = await panel<{ error: string; details: { limit: string; max: number } }>(
        'POST',
        '/products',
        { name: 'Segunda', basePrice: 1000 },
      );

      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({
        error: 'plan_limit',
        details: { limit: 'maxProducts', max: 1 },
      });
    });

    it('la consola cuenta las prendas de cada tienda aunque estén bajo RLS', async () => {
      const { body } = await platform<StoreRow[]>('GET', `/stores?q=${shop.slug}`);

      expect(body.find((store) => store.id === shop.storeId)?.productCount).toBe(1);
    });

    it('la tienda ve su plan, hasta cuándo está paga y cuánto lleva usado', async () => {
      const { status, body } = await panel<Summary>('GET', '/subscription');

      expect(status).toBe(200);
      expect(body).toMatchObject({
        plan: { code: 'basico', maxProducts: 1 },
        status: 'ACTIVE',
        storeStatus: 'ACTIVE',
        currentPeriodEnd: '2026-11-30',
        usage: { products: 1, ordersThisMonth: 0 },
      });
      expect(body.daysLeft).toBeGreaterThan(0);
    });
  });

  describe('resumen del negocio', () => {
    interface Dashboard {
      stores: { total: number; active: number; trial: number };
      payingStores: number;
      mrr: number;
      revenueThisMonth: number;
      trialsEnding: { id: string; daysLeft: number }[];
      overdue: { id: string }[];
      recentPayments: { storeId: string; amountCop: number; storeSlug: string }[];
    }

    it('cuenta la tienda que paga, su plan en el MRR y sus pagos del mes', async () => {
      const { status, body } = await platform<Dashboard>('GET', '/dashboard');

      expect(status).toBe(200);
      expect(body.stores.total).toBeGreaterThanOrEqual(body.stores.active + body.stores.trial);
      expect(body.payingStores).toBeGreaterThanOrEqual(1);
      // La tienda de prueba está en Básico y activa: su plan cuenta en el MRR.
      expect(body.mrr).toBeGreaterThanOrEqual(49000);
      // Tres pagos de 49.000 registrados hoy en esta suite.
      expect(body.revenueThisMonth).toBeGreaterThanOrEqual(3 * 49000);
      expect(
        body.recentPayments.filter((payment) => payment.storeId === shop.storeId),
      ).toHaveLength(3);
      expect(body.recentPayments[0]?.storeSlug).toBeDefined();
    });

    it('lista los pagos de un mes con su total; un mes vacío da cero', async () => {
      const month = new Date().toISOString().slice(0, 7);
      const current = await platform<{ total: number; payments: { storeId: string }[] }>(
        'GET',
        `/payments?month=${month}`,
      );

      expect(current.status).toBe(200);
      expect(current.body.total).toBeGreaterThanOrEqual(3 * 49000);
      expect(current.body.payments.some((payment) => payment.storeId === shop.storeId)).toBe(true);

      const empty = await platform<{ total: number; payments: unknown[] }>(
        'GET',
        '/payments?month=2000-01',
      );

      expect(empty.body).toEqual({ month: '2000-01', total: 0, payments: [] });
      expect((await platform('GET', '/payments?month=2026-9')).status).toBe(400);
    });
  });

  describe('vencimientos', () => {
    it('reconcile marca como vencidas las pruebas terminadas y los períodos pasados', async () => {
      const trial = await api.register('platform-trial');
      const paid = await api.register('platform-paid');

      await api.withOwner(async (client) => {
        await client.query(
          `update stores set trial_ends_at = now() - interval '1 day' where id = $1`,
          [trial.storeId],
        );
        await client.query('begin');
        await client.query(`select set_config('app.store_id', $1, true)`, [paid.storeId]);
        await client.query(
          `update subscriptions set status = 'ACTIVE', current_period_end = current_date - 1 where store_id = $1`,
          [paid.storeId],
        );
        await client.query('commit');
        await client.query(
          `update stores set status = 'ACTIVE', trial_ends_at = null where id = $1`,
          [paid.storeId],
        );
      });

      // Por tienda: sin `storeId` recorrería también las tiendas de desarrollo.
      for (const store of [trial, paid, shop]) {
        const { body } = await platform<{ markedPastDue: number }>(
          'POST',
          `/reconcile?storeId=${store.storeId}`,
        );

        expect(body.markedPastDue).toBe(store === shop ? 0 : 1);
      }

      const overdue = await platform<StoreRow[]>('GET', '/stores?overdue=true');
      const ids = overdue.body.map((store) => store.id);

      expect(ids).toEqual(expect.arrayContaining([trial.storeId, paid.storeId]));
      expect(ids).not.toContain(shop.storeId);
      expect(overdue.body.find((store) => store.id === paid.storeId)).toMatchObject({
        status: 'PAST_DUE',
        subscriptionStatus: 'PAST_DUE',
      });

      // Vencida sigue vendiendo: PAST_DUE solo avisa.
      expect((await api.call('GET', `/public/${paid.slug}`)).status).toBe(200);

      const summary = await platform<{ overdue: { id: string }[] }>('GET', '/dashboard');

      expect(summary.body.overdue.map((store) => store.id)).toEqual(
        expect.arrayContaining([trial.storeId, paid.storeId]),
      );
    });
  });
});
