import type { Session, TestApp } from './utils/test-app';

/**
 * Pagar el plan: ir a la pasarela, volver, y que el evento sea lo que manda.
 *
 * Corre con la pasarela simulada, que lleva a una página del propio sitio en
 * vez de cobrar. El flujo es el mismo que con Wompi —se crea el cobro, alguien
 * externo lo aprueba, el evento lo confirma—, así que lo que se prueba acá es
 * lo nuestro: que el período se extienda, que no se extienda dos veces y que
 * un pago corto no compre un mes.
 *
 * Se fija acá arriba y `test-app` se importa de forma dinámica porque
 * `ConfigModule` valida el entorno cuando se importa `AppModule` y no vuelve a
 * mirarlo.
 */
process.env.PAYMENTS_DRIVER = 'simulated';

jest.setTimeout(60_000);

interface Payment {
  amountCop: number;
  periodStart: string;
  periodEnd: string;
  method: string;
}

interface PaymentMethod {
  connected: boolean;
  brand: string | null;
  last4: string | null;
}

interface Summary {
  plan: { code: string; priceCop: number };
  status: string;
  storeStatus: string;
  currentPeriodEnd: string;
  daysLeft: number;
  selfServiceBilling: boolean;
  paymentMethod: PaymentMethod;
  payments: Payment[];
}

interface Checkout {
  url: string;
  reference: string;
  amountCop: number;
  error?: string;
}

/** Lo que cubre un pago, como en `SubscriptionsService`. */
const PERIOD_DAYS = 30;

describe('Pagar el plan (e2e)', () => {
  let api: TestApp;
  let shop: Session;

  const summary = (session: Session) =>
    api.call<Summary>('GET', `/stores/${session.storeId}/subscription`, session);

  const checkout = (session: Session, planCode: string) =>
    api.call<Checkout>('POST', `/stores/${session.storeId}/subscription/checkout`, session, {
      planCode,
    });

  /** Lo que hace la pasarela cuando el pago se aprueba. */
  const aprobar = (reference: string, amountCop: number) =>
    api.call('POST', '/payments/events', undefined, { reference, amountCop });

  /** Una escritura cualquiera del panel: lo que se pierde con el plan vencido. */
  const write = (session: Session, name: string) =>
    api.call<{ error?: string }>('POST', `/stores/${session.storeId}/categories`, session, {
      name,
    });

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
    shop = await api.register('pagos-plan', 'pro');
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('plan vencido', () => {
    it('el panel queda en solo lectura, pero pagar sí se puede', async () => {
      await expire(shop, 'PAST_DUE');

      const bloqueada = await write(shop, 'VENCIDA');

      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.error).toBe('subscription_required');

      // Ir a pagar es justo lo que saca a la tienda de ahí.
      expect((await checkout(shop, 'pro')).status).toBe(201);
      expect((await summary(shop)).body.selfServiceBilling).toBe(true);
    });
  });

  describe('la tarjeta guardada', () => {
    // Una sola tienda para los cuatro casos: registrar tiene límite por IP, y
    // gastarlo acá hace fallar pruebas de más abajo que no tienen la culpa.
    let tarjeta: Session;

    const guardar = (session: Session, cardToken: string) =>
      api.call<PaymentMethod & { error?: string }>(
        'PUT',
        `/stores/${session.storeId}/subscription/payment-method`,
        session,
        { cardToken, acceptanceToken: 'acc_de_prueba' },
      );

    const olvidar = (session: Session) =>
      api.call<PaymentMethod>(
        'DELETE',
        `/stores/${session.storeId}/subscription/payment-method`,
        session,
      );

    beforeAll(async () => {
      tarjeta = await api.register('pagos-tarjeta');
    });

    it('se guarda con el token del navegador y se puede decir con qué se cobra', async () => {
      expect((await summary(tarjeta)).body.paymentMethod.connected).toBe(false);

      const { status, body } = await guardar(tarjeta, 'tok_de_prueba_4242');

      expect(status).toBe(200);
      expect(body.connected).toBe(true);
      expect(body.last4).toBe('4242');

      // Y se ve en el resumen, que es de donde lo lee el panel.
      expect((await summary(tarjeta)).body.paymentMethod).toMatchObject({
        connected: true,
        last4: '4242',
      });
    });

    it('guardarla no cobra nada: la prueba sigue como estaba', async () => {
      const antes = (await summary(tarjeta)).body;

      await guardar(tarjeta, 'tok_de_prueba_1111');

      const despues = (await summary(tarjeta)).body;

      expect(despues.currentPeriodEnd).toBe(antes.currentPeriodEnd);
      expect(despues.payments).toHaveLength(0);
    });

    it('se puede dejar de cobrar solo', async () => {
      expect((await olvidar(tarjeta)).body).toEqual({
        connected: false,
        brand: null,
        last4: null,
      });
    });

    it('con el plan vencido todavía se puede poner una tarjeta', async () => {
      await expire(tarjeta, 'PAST_DUE');

      expect((await guardar(tarjeta, 'tok_de_prueba_7777')).status).toBe(200);
    });
  });

  describe('el cobro', () => {
    it('lleva a la pasarela con el monto del plan, no con el que pidan', async () => {
      const { status, body } = await checkout(shop, 'pro');

      expect(status).toBe(201);
      expect(body.amountCop).toBe(99_000);
      expect(body.url).toContain('/pagos/simulado');
      expect(body.url).toContain(encodeURIComponent(body.reference));
    });

    it('un plan que no se ofrece no se puede pagar', async () => {
      expect((await checkout(shop, 'plan-inventado')).status).toBe(400);
    });

    it('una tienda suspendida no paga para reactivarse', async () => {
      const suspendida = await api.register('pagos-suspendida');

      await expire(suspendida, 'SUSPENDED');

      const rechazado = await checkout(suspendida, 'basico');

      expect(rechazado.status).toBe(403);
      expect(rechazado.body.error).toBe('store_suspended');
    });
  });

  describe('el evento', () => {
    it('es el que pone el plan al día, no el volver a la página', async () => {
      const cobro = await checkout(shop, 'pro');

      // Antes del evento no pasó nada: la dueña pudo no haber pagado.
      expect((await summary(shop)).body.storeStatus).toBe('PAST_DUE');

      await aprobar(cobro.body.reference, cobro.body.amountCop);

      const { body } = await summary(shop);

      expect(body.status).toBe('ACTIVE');
      expect(body.storeStatus).toBe('ACTIVE');
      expect(body.daysLeft).toBe(PERIOD_DAYS - 1);
      expect(body.payments[0]).toMatchObject({ amountCop: 99_000, method: 'simulado' });

      expect((await write(shop, 'PAGADA')).status).toBe(201);
    });

    it('el mismo pago dos veces no compra dos meses', async () => {
      const antes = (await summary(shop)).body;
      const cobro = await checkout(shop, 'pro');

      await aprobar(cobro.body.reference, cobro.body.amountCop);
      const unPago = (await summary(shop)).body;

      // El mismo evento otra vez: la pasarela reintenta, y reintentar no suma.
      await aprobar(cobro.body.reference, cobro.body.amountCop);
      const otraVez = (await summary(shop)).body;

      expect(unPago.daysLeft).toBe(antes.daysLeft + PERIOD_DAYS);
      expect(otraVez.daysLeft).toBe(unPago.daysLeft);
      expect(otraVez.payments).toHaveLength(unPago.payments.length);
    });

    it('un pago por menos del plan no compra nada', async () => {
      const antes = (await summary(shop)).body;
      const cobro = await checkout(shop, 'pro');

      await aprobar(cobro.body.reference, 1000);

      const despues = (await summary(shop)).body;

      expect(despues.daysLeft).toBe(antes.daysLeft);
      expect(despues.payments).toHaveLength(antes.payments.length);
    });

    it('una referencia que no reconocemos no rompe nada', async () => {
      const { status } = await aprobar('cualquier-cosa', 99_000);

      expect(status).toBe(200);
    });
  });
});
