import {
  platformNotificationEventSchema,
  storeNotificationEventSchema,
} from './notification-events';

const ORDER = '44444444-4444-4444-8444-444444444444';
const STORE = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

describe('avisos de tienda', () => {
  it('acepta un pedido nuevo con lo justo', () => {
    const parsed = storeNotificationEventSchema.safeParse({
      type: 'ORDER_PLACED',
      data: { orderId: ORDER, number: 12, total: 189800, itemCount: 2, paid: false },
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza un aviso con datos de la clienta', () => {
    const parsed = storeNotificationEventSchema.safeParse({
      type: 'ORDER_PLACED',
      data: {
        orderId: ORDER,
        number: 12,
        total: 189800,
        itemCount: 2,
        paid: false,
        customerName: 'Ana',
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un tipo de plataforma en la bandeja de tienda', () => {
    const parsed = storeNotificationEventSchema.safeParse({
      type: 'STORE_CREATED',
      data: { storeId: STORE, storeName: 'Luna', slug: 'luna', userId: USER, newAccount: true },
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza montos negativos o con decimales', () => {
    const negative = storeNotificationEventSchema.safeParse({
      type: 'ORDER_PAID',
      data: { orderId: ORDER, number: 1, total: -1 },
    });
    const decimal = storeNotificationEventSchema.safeParse({
      type: 'ORDER_PAID',
      data: { orderId: ORDER, number: 1, total: 899.5 },
    });

    expect(negative.success).toBe(false);
    expect(decimal.success).toBe(false);
  });
});

describe('avisos de plataforma', () => {
  it('acepta cada tipo con su forma', () => {
    const events = [
      {
        type: 'STORE_CREATED',
        data: { storeId: STORE, storeName: 'Luna', slug: 'luna', userId: USER, newAccount: true },
      },
      { type: 'USER_REGISTERED', data: { userId: USER } },
      {
        type: 'SUBSCRIPTION_PAID',
        data: { storeId: STORE, storeName: 'Luna', amountCop: 49900, planCode: 'basico' },
      },
      {
        type: 'SUBSCRIPTION_FAILED',
        data: { storeId: STORE, storeName: 'Luna', amountCop: 49900, planCode: 'basico' },
      },
      {
        type: 'SUPPORT_TICKET_OPENED',
        data: { ticketId: ORDER, storeId: STORE, storeName: 'Luna' },
      },
      {
        type: 'SUPPORT_OWNER_REPLIED',
        data: { ticketId: ORDER, storeId: STORE, storeName: 'Luna' },
      },
    ];

    for (const event of events) {
      expect(platformNotificationEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('el aviso de soporte no lleva el texto del caso', () => {
    const parsed = platformNotificationEventSchema.safeParse({
      type: 'SUPPORT_TICKET_OPENED',
      data: { ticketId: ORDER, storeId: STORE, storeName: 'Luna', subject: 'No me llega' },
    });

    expect(parsed.success).toBe(false);
  });
});
