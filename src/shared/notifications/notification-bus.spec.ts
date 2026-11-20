import { NotificationDto } from '@shared/dtos/notifications/notifications.dto';

import { InMemoryNotificationBus, platformChannel, storeChannel } from './notification-bus';

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function notification(id: string): NotificationDto {
  return {
    id,
    createdAt: '2026-11-20T12:00:00.000Z',
    readAt: null,
    type: 'ORDER_PAID',
    data: { orderId: '44444444-4444-4444-8444-444444444444', number: 7, total: 89900 },
  };
}

describe('InMemoryNotificationBus', () => {
  it('entrega solo al canal de esa persona en esa tienda', () => {
    const bus = new InMemoryNotificationBus();
    const inA: string[] = [];
    const inB: string[] = [];
    const inPlatform: string[] = [];

    bus.subscribe(storeChannel(STORE_A, USER), (n) => inA.push(n.id));
    bus.subscribe(storeChannel(STORE_B, USER), (n) => inB.push(n.id));
    bus.subscribe(platformChannel(USER), (n) => inPlatform.push(n.id));

    bus.publish(storeChannel(STORE_A, USER), notification('a'));

    expect(inA).toEqual(['a']);
    expect(inB).toEqual([]);
    expect(inPlatform).toEqual([]);
  });

  it('entrega a todas las pestañas de la misma persona', () => {
    const bus = new InMemoryNotificationBus();
    const received: string[] = [];

    bus.subscribe(platformChannel(USER), (n) => received.push(`1:${n.id}`));
    bus.subscribe(platformChannel(USER), (n) => received.push(`2:${n.id}`));

    bus.publish(platformChannel(USER), notification('x'));

    expect(received).toEqual(['1:x', '2:x']);
  });

  it('una pestaña que falla no deja sin aviso a las demás', () => {
    const bus = new InMemoryNotificationBus();
    const received: string[] = [];

    bus.subscribe(platformChannel(USER), () => {
      throw new Error('socket cerrado');
    });
    bus.subscribe(platformChannel(USER), (n) => received.push(n.id));

    expect(() => bus.publish(platformChannel(USER), notification('x'))).not.toThrow();
    expect(received).toEqual(['x']);
  });

  it('al desuscribirse deja de recibir y libera el canal', () => {
    const bus = new InMemoryNotificationBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe(storeChannel(STORE_A, USER), (n) => received.push(n.id));

    expect(bus.openChannels).toBe(1);

    unsubscribe();
    unsubscribe();
    bus.publish(storeChannel(STORE_A, USER), notification('tarde'));

    expect(received).toEqual([]);
    expect(bus.openChannels).toBe(0);
  });

  it('publicar en un canal sin nadie conectado no hace nada', () => {
    const bus = new InMemoryNotificationBus();

    expect(() => bus.publish(platformChannel(USER), notification('nadie'))).not.toThrow();
    expect(bus.openChannels).toBe(0);
  });
});
