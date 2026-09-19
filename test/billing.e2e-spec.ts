import type { Session, TestApp } from './utils/test-app';

/**
 * El plan visto desde la tienda: elegirlo al registrarse, quedarse sin él y
 * volver a activarlo pagando.
 *
 * Mientras no hay pasarela, `BILLING_DRIVER=simulated` deja que la tienda se
 * cobre sola. Se fija acá arriba y `test-app` se importa de forma dinámica
 * porque `ConfigModule` valida el entorno cuando se importa `AppModule` y no
 * vuelve a mirarlo: una asignación después de la importación llegaría tarde.
 *
 * El modo de verdad —`manual`, sin pagos en línea— lo cubre platform.e2e-spec.
 */
process.env.BILLING_DRIVER = 'simulated';

jest.setTimeout(60_000);

interface Payment {
  amountCop: number;
  periodStart: string;
  periodEnd: string;
  method: string;
}

interface Summary {
  plan: { code: string; priceCop: number };
  status: string;
  storeStatus: string;
  currentPeriodEnd: string;
  daysLeft: number;
  selfServiceBilling: boolean;
  payments: Payment[];
}

/** Lo que cubre un pago, como en `SubscriptionsService`. */
const PERIOD_DAYS = 30;

describe('Cobro simulado (e2e)', () => {
  let api: TestApp;
  let shop: Session;

  const summary = (session: Session) =>
    api.call<Summary>('GET', `/stores/${session.storeId}/subscription`, session);

  const activate = (session: Session, planCode: string) =>
    api.call<Summary & { error?: string }>(
      'POST',
      `/stores/${session.storeId}/subscription/activate`,
      session,
      { planCode },
    );

  /** Una escritura cualquiera del panel: lo que se pierde con el plan vencido. */
  const write = (session: Session, label: string) =>
    api.call<{ error?: string }>('POST', `/stores/${session.storeId}/sizes`, session, { label });

  /** Vence el período y deja la tienda como la dejaría `reconcile`. */
  const expire = (session: Session, storeStatus: 'PAST_DUE' | 'SUSPENDED') =>
    api.withOwner(async (client) => {
      await client.query('begin');
      await client.query(`select set_config('app.store_id', $1, true)`, [session.storeId]);
      await client.query(
        `update subscriptions set status = 'PAST_DUE', current_period_end = current_date - 1 where store_id = $1`,
        [session.storeId],
      );
      await client.query('commit');
      await client.query(`update stores set status = $2, trial_ends_at = null where id = $1`, [
        session.storeId,
        storeStatus,
      ]);
    });

  beforeAll(async () => {
    const { startTestApp } = await import('./utils/test-app');

    api = await startTestApp();
    shop = await api.register('billing-shop', 'pro');
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('elegir plan al registrarse', () => {
    it('la tienda queda en el plan que eligió', async () => {
      const { status, body } = await summary(shop);

      expect(status).toBe(200);
      expect(body.plan.code).toBe('pro');
      expect(body.storeStatus).toBe('TRIAL');
      expect(body.selfServiceBilling).toBe(true);
      expect(body.payments).toEqual([]);
    });

    it('un plan que no existe no tumba el registro: entra al básico', async () => {
      const raro = await api.register('billing-raro', 'plan-inventado');

      expect((await summary(raro)).body.plan.code).toBe('basico');
    });
  });

  describe('plan vencido', () => {
    it('el panel queda en solo lectura y lo dice', async () => {
      await expire(shop, 'PAST_DUE');

      const bloqueada = await write(shop, 'VENCIDA');

      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.error).toBe('subscription_required');

      // Mirar sigue permitido, y el plan también: por ahí se sale del bloqueo.
      expect((await api.call('GET', `/stores/${shop.storeId}/sizes`, shop)).status).toBe(200);
      expect((await summary(shop)).body.storeStatus).toBe('PAST_DUE');
    });
  });

  describe('pagar', () => {
    it('activar el plan devuelve el panel y deja el pago registrado', async () => {
      const { status, body } = await activate(shop, 'pro');

      expect(status).toBe(201);
      expect(body.status).toBe('ACTIVE');
      expect(body.storeStatus).toBe('ACTIVE');
      expect(body.daysLeft).toBe(PERIOD_DAYS - 1);
      expect(body.payments).toHaveLength(1);
      expect(body.payments[0]).toMatchObject({ amountCop: 99_000, method: 'simulado' });

      expect((await write(shop, 'PAGADA')).status).toBe(201);
    });

    it('pagar de nuevo suma un mes, no lo reinicia', async () => {
      const antes = (await summary(shop)).body;
      const { body } = await activate(shop, 'pro');

      expect(body.payments).toHaveLength(2);
      // El período nuevo empieza donde terminó el vigente.
      expect(body.payments[0]?.periodStart).toBe(dayAfter(antes.currentPeriodEnd));
      expect(body.daysLeft).toBe(antes.daysLeft + PERIOD_DAYS);
    });

    it('cambiar de plan al pagar cambia el plan y el precio', async () => {
      const { body } = await activate(shop, 'basico');

      expect(body.plan.code).toBe('basico');
      expect(body.payments[0]?.amountCop).toBe(49_000);
    });

    it('un plan que no se ofrece no se puede activar', async () => {
      expect((await activate(shop, 'plan-inventado')).status).toBe(400);
    });

    it('una tienda suspendida no se reactiva pagando', async () => {
      const suspendida = await api.register('billing-suspendida');

      await expire(suspendida, 'SUSPENDED');

      // Suspender fue una decisión de la plataforma: cobrarle sería cobrarle
      // por algo que el pago no le devuelve.
      const rechazado = await activate(suspendida, 'basico');

      expect(rechazado.status).toBe(403);
      expect(rechazado.body.error).toBe('store_suspended');
      expect((await summary(suspendida)).body.payments).toEqual([]);
    });
  });
});

/** El día siguiente a una fecha `YYYY-MM-DD`, en el mismo formato. */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`).getTime() + 86_400_000;

  return new Date(next).toISOString().slice(0, 10);
}
