import { Test } from '@nestjs/testing';
import { NotificationBus } from '@shared/notifications/notification-bus';
import { PrismaService } from '@db/prisma.service';

import { NotificationsService } from './notifications.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const ORDER = '44444444-4444-4444-8444-444444444444';
const USER = '33333333-3333-4333-8333-333333333333';

async function setup(prisma: object) {
  const bus = { publish: jest.fn(), subscribe: jest.fn() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      NotificationsService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationBus, useValue: bus },
    ],
  }).compile();

  return { notifications: moduleRef.get(NotificationsService), bus };
}

describe('NotificationsService: nunca tumba a quien avisa', () => {
  it('si la base falla al guardar un aviso de tienda, resuelve sin publicar nada', async () => {
    const { notifications, bus } = await setup({
      forStore: jest.fn().mockRejectedValue(new Error('base caída')),
    });

    await expect(
      notifications.notifyStore(STORE, {
        type: 'ORDER_PAID',
        data: { orderId: ORDER, number: 1, total: 89900 },
      }),
    ).resolves.toBeUndefined();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('si la base falla al guardar un aviso de plataforma, resuelve sin publicar nada', async () => {
    const { notifications, bus } = await setup({
      platformAdmin: { findMany: jest.fn().mockRejectedValue(new Error('base caída')) },
    });

    await expect(
      notifications.notifyPlatform({
        type: 'USER_REGISTERED',
        data: { userId: USER, storeId: null, storeName: null },
      }),
    ).resolves.toBeUndefined();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('sin nadie en la plataforma no escribe nada', async () => {
    const createManyAndReturn = jest.fn();
    const { notifications } = await setup({
      platformAdmin: { findMany: jest.fn().mockResolvedValue([]) },
      platformNotification: { createManyAndReturn },
    });

    await notifications.notifyPlatform({
      type: 'USER_REGISTERED',
      data: { userId: USER, storeId: null, storeName: null },
    });

    expect(createManyAndReturn).not.toHaveBeenCalled();
  });
});
