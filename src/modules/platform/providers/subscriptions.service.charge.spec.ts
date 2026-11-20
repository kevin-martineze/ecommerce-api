import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaymentGateway } from '@shared/payments/gateway';
import { PrismaService } from '@db/prisma.service';
import { NotificationsService } from '@modules/notifications/providers/notifications.service';

import { SubscriptionsService } from './subscriptions.service';

const STORE = { id: '11111111-1111-4111-8111-111111111111', name: 'Luna' };
const PLAN = { code: 'basico', name: 'Básico', priceCop: 49900, active: true };

/** Una tienda con tarjeta guardada y el período vencido: el cron la cobra. */
async function setup(charge: jest.Mock) {
  const tx = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue({
        planCode: PLAN.code,
        paymentSourceId: 'fuente-1',
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-01-01'),
        chargeFailures: 0,
        lastChargeAt: null,
        plan: PLAN,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    store: { findMany: jest.fn().mockResolvedValue([STORE]) },
    storeMember: { findFirst: jest.fn().mockResolvedValue({ user: { email: 'duena@x.test' } }) },
    forStore: jest.fn(<T>(_storeId: string, work: (client: typeof tx) => Promise<T>) => work(tx)),
  };
  const notifications = {
    notifyStore: jest.fn().mockResolvedValue(undefined),
    notifyPlatform: jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SubscriptionsService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: new ConfigService({}) },
      { provide: NotificationsService, useValue: notifications },
      { provide: PaymentGateway, useValue: { supportsRecurring: true, charge } },
    ],
  }).compile();

  return { subscriptions: moduleRef.get(SubscriptionsService), notifications };
}

const FAILED = {
  type: 'SUBSCRIPTION_FAILED',
  data: { storeId: STORE.id, storeName: STORE.name, amountCop: PLAN.priceCop, planCode: PLAN.code },
};

describe('SubscriptionsService.chargeDue: aviso de cobro fallido', () => {
  it('un cobro rechazado avisa a la plataforma una vez', async () => {
    const { subscriptions, notifications } = await setup(
      jest.fn().mockResolvedValue({
        reference: 'r',
        transactionId: 't',
        status: 'declined',
        amountCop: PLAN.priceCop,
        method: 'prueba',
      }),
    );

    await expect(subscriptions.chargeDue(new Date('2026-02-01'))).resolves.toEqual({
      charged: 0,
      failed: 1,
    });
    expect(notifications.notifyPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.notifyPlatform).toHaveBeenCalledWith(FAILED);
  });

  it('una pasarela que falla también avisa', async () => {
    const { subscriptions, notifications } = await setup(
      jest.fn().mockRejectedValue(new Error('sin red')),
    );

    await subscriptions.chargeDue(new Date('2026-02-01'));

    expect(notifications.notifyPlatform).toHaveBeenCalledWith(FAILED);
  });

  it('un cobro pendiente no es un fallo y no avisa', async () => {
    const { subscriptions, notifications } = await setup(
      jest.fn().mockResolvedValue({
        reference: 'r',
        transactionId: 't',
        status: 'pending',
        amountCop: PLAN.priceCop,
        method: 'prueba',
      }),
    );

    await subscriptions.chargeDue(new Date('2026-02-01'));

    expect(notifications.notifyPlatform).not.toHaveBeenCalled();
  });
});
