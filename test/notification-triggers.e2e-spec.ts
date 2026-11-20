import { OrderPaymentsService } from '@modules/payments/providers/order-payments.service';
import { SubscriptionsService } from '@modules/platform/providers/subscriptions.service';
import { PaymentEvent } from '@shared/payments/gateway';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Los disparadores de avisos, de punta a punta: cada evento real deja un aviso
 * y uno solo, y las repeticiones (idempotencia, reintentos de la pasarela) no
 * dejan ninguno.
 *
 * Los pagos se aplican llamando al servicio con el evento ya leído: la firma
 * de la pasarela tiene sus propias pruebas, y así esta no depende del driver
 * de pagos del `.env`.
 */

jest.setTimeout(60_000);

interface Item {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface List {
  items: Item[];
  unread: number;
}

interface Created {
  id: string;
  number: number;
  total: number;
}

describe('Disparadores de avisos (e2e)', () => {
  let api: TestApp;
  let owner: Session;
  let team: Session;
  let zoneId: string;
  let variantId: string;

  const storeInbox = async (type: string): Promise<Item[]> => {
    const { body } = await api.call<List>(
      'GET',
      `/stores/${owner.storeId}/notifications?limit=50`,
      owner,
    );

    return body.items.filter((item) => item.type === type);
  };

  const platformInbox = async (type: string): Promise<Item[]> => {
    const { body } = await api.call<List>('GET', '/platform/notifications?limit=50', team);

    return body.items.filter((item) => item.type === type);
  };

  const placeOrder = (key: string) =>
    api.call<Created>(
      'POST',
      `/public/${owner.slug}/orders`,
      undefined,
      {
        customer: { name: 'Ana Gómez', phone: '300 123 4567', city: 'Bogotá' },
        shippingZoneId: zoneId,
        items: [{ variantId, qty: 2 }],
      },
      { 'idempotency-key': key },
    );

  beforeAll(async () => {
    api = await startTestApp();
    team = await api.register('disparos-equipo');

    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        team.email,
      ]),
    );

    // Después de volver administradora a `team`: su registro no la vio.
    owner = await api.register('disparos-duena');

    zoneId = (
      await api.call<{ id: string }>('POST', `/stores/${owner.storeId}/shipping-zones`, owner, {
        name: 'Bogotá',
        cost: 8000,
        etaDays: 2,
      })
    ).body.id;

    const product = await api.seedProduct(
      owner,
      { name: 'Blusa Aviso', basePrice: 50000, status: 'ACTIVE' },
      [],
      20,
    );

    variantId = product.variants[0]?.id ?? '';
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('tienda nueva', () => {
    it('registrar cuenta y tienda deja un solo aviso, como cuenta nueva', async () => {
      const mine = (await platformInbox('STORE_CREATED')).filter(
        (item) => item.data.storeId === owner.storeId,
      );

      expect(mine).toHaveLength(1);
      expect(mine[0]?.data).toMatchObject({ slug: owner.slug, newAccount: true });
      expect(await platformInbox('USER_REGISTERED')).toEqual([]);
    });
  });

  describe('pedidos', () => {
    let order: Created;

    it('un pedido nuevo avisa una vez, sin datos de la clienta', async () => {
      const first = await placeOrder('aviso-pedido-1');

      expect(first.status).toBe(201);
      order = first.body;

      const placed = await storeInbox('ORDER_PLACED');

      expect(placed).toHaveLength(1);
      expect(placed[0]?.data).toEqual({
        orderId: order.id,
        number: order.number,
        total: order.total,
        itemCount: 2,
        paid: false,
      });
      expect(JSON.stringify(placed[0])).not.toMatch(/Ana|300 123|Bogotá/);
    });

    it('repetir el envío con la misma clave no vuelve a avisar', async () => {
      const again = await placeOrder('aviso-pedido-1');

      expect(again.body.id).toBe(order.id);
      expect(await storeInbox('ORDER_PLACED')).toHaveLength(1);
    });

    it('un pago parcial, pendiente o rechazado no avisa', async () => {
      const payments = api.get(OrderPaymentsService);
      const reference = `ord-${order.id}`;

      await payments.applyPayment(owner.storeId, {
        reference,
        transactionId: 'tx-parcial',
        status: 'approved',
        amountCop: order.total - 1,
        method: 'prueba',
      });
      await payments.applyPayment(owner.storeId, {
        reference,
        transactionId: 'tx-pendiente',
        status: 'pending',
        amountCop: order.total,
        method: 'prueba',
      });
      await payments.applyPayment(owner.storeId, {
        reference,
        transactionId: 'tx-rechazado',
        status: 'declined',
        amountCop: order.total,
        method: 'prueba',
      });

      expect(await storeInbox('ORDER_PAID')).toEqual([]);
    });

    it('el pago aprobado avisa una vez, aunque la pasarela lo reintente', async () => {
      const payments = api.get(OrderPaymentsService);
      const approved: PaymentEvent = {
        reference: `ord-${order.id}`,
        transactionId: 'tx-bueno',
        status: 'approved',
        amountCop: order.total,
        method: 'prueba',
      };

      // Dos entregas simultáneas del mismo evento y un reintento después.
      await Promise.all([
        payments.applyPayment(owner.storeId, approved),
        payments.applyPayment(owner.storeId, approved),
      ]);
      await payments.applyPayment(owner.storeId, approved);

      const paid = await storeInbox('ORDER_PAID');

      expect(paid).toHaveLength(1);
      expect(paid[0]?.data).toEqual({
        orderId: order.id,
        number: order.number,
        total: order.total,
      });
    });

    it('otro pago aprobado sobre un pedido ya pagado no avisa', async () => {
      await api.get(OrderPaymentsService).applyPayment(owner.storeId, {
        reference: `ord-${order.id}`,
        transactionId: 'tx-otro',
        status: 'approved',
        amountCop: order.total,
        method: 'prueba',
      });

      expect(await storeInbox('ORDER_PAID')).toHaveLength(1);
    });
  });

  describe('plan', () => {
    it('el pago del plan avisa una vez; el repetido, ninguna', async () => {
      const plan = await api.withOwner(async (client) => {
        const { rows } = await client.query<{ code: string; price_cop: number }>(
          `select code, price_cop from plans
           where active and price_cop > 0 and code not like '%-%'
           order by price_cop limit 1`,
        );

        return rows[0];
      });

      if (!plan) {
        throw new Error('La base no tiene un plan pagado para probar.');
      }

      const event: PaymentEvent = {
        reference: `sub-${owner.storeId}-${plan.code}-abcd1234`,
        transactionId: `tx-plan-${owner.storeId}`,
        status: 'approved',
        amountCop: plan.price_cop,
        method: 'prueba',
      };
      const subscriptions = api.get(SubscriptionsService);

      await subscriptions.applyPayment(event);
      await subscriptions.applyPayment(event);

      const paid = (await platformInbox('SUBSCRIPTION_PAID')).filter(
        (item) => item.data.storeId === owner.storeId,
      );

      expect(paid).toHaveLength(1);
      expect(paid[0]?.data).toMatchObject({ amountCop: plan.price_cop, planCode: plan.code });
    });
  });

  describe('soporte', () => {
    it('abrir un caso y escribir en él avisan a la plataforma, sin el texto', async () => {
      const opened = await api.call<{ ticket: { id: string } }>(
        'POST',
        `/stores/${owner.storeId}/support/tickets`,
        owner,
        {
          subject: 'Asunto que no debe salir',
          category: 'OTHER',
          body: 'Un mensaje que tampoco debe salir en el aviso.',
        },
      );
      const ticketId = opened.body.ticket.id;

      await api.call(
        'POST',
        `/stores/${owner.storeId}/support/tickets/${ticketId}/messages`,
        owner,
        {
          body: 'Otra cosa que contar.',
        },
      );

      const [newTicket, reply] = await Promise.all([
        platformInbox('SUPPORT_TICKET_OPENED'),
        platformInbox('SUPPORT_OWNER_REPLIED'),
      ]);

      expect(newTicket.map((item) => item.data.ticketId)).toEqual([ticketId]);
      expect(reply.map((item) => item.data.ticketId)).toEqual([ticketId]);
      expect(JSON.stringify([...newTicket, ...reply])).not.toMatch(/Asunto|mensaje|contar/);
    });
  });
});
