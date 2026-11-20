import { NotificationsService } from '@modules/notifications/providers/notifications.service';
import { PushOutcome, PushSender, PushTarget } from '@shared/notifications/push-sender';
import { StoreNotificationEvent } from '@shared/notifications/notification-events';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Avisos push de punta a punta, con un servicio push de mentira: quién se
 * suscribe, a qué bandeja, qué viaja y qué pasa cuando el navegador ya no está.
 */

jest.setTimeout(60_000);

const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const PUBLIC_KEY = 'BPrueba-llave-publica-de-mentira-para-los-e2e-de-avisos-push';

/** Anota cada envío. Los endpoints en `gone` responden como un navegador que ya no existe. */
class FakePushSender extends PushSender {
  readonly publicKey = PUBLIC_KEY;
  readonly sent: { endpoint: string; payload: string }[] = [];
  readonly gone = new Set<string>();

  send(target: PushTarget, payload: string): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, payload });

    return Promise.resolve(this.gone.has(target.endpoint) ? 'gone' : 'sent');
  }

  to(endpoint: string): { endpoint: string; payload: string }[] {
    return this.sent.filter((entry) => entry.endpoint === endpoint);
  }
}

function orderPaid(number: number): StoreNotificationEvent {
  return { type: 'ORDER_PAID', data: { orderId: ORDER_ID, number, total: 89900 } };
}

let counter = 0;

/** Un navegador nuevo: su endpoint de FCM y sus llaves. */
function browser() {
  counter += 1;

  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/prueba-${Date.now()}-${counter}`,
    keys: { p256dh: 'BLlaveDelNavegador_123-abc', auth: 'secreto_auth-1' },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Avisos push (e2e)', () => {
  let api: TestApp;
  let push: FakePushSender;
  let notifications: NotificationsService;
  let owner: Session;
  let otherOwner: Session;
  let team: Session;

  const storePath = (session: Session) => `/stores/${session.storeId}/notifications`;

  /** El envío no se espera: da un momento para que salga. */
  const settle = () => sleep(150);

  beforeAll(async () => {
    push = new FakePushSender();
    api = await startTestApp({ pushSender: push });
    notifications = api.get(NotificationsService);

    owner = await api.register('push-duena');
    otherOwner = await api.register('push-otra');
    team = await api.register('push-equipo');

    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        team.email,
      ]),
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  it('da la llave pública al panel y a la consola', async () => {
    const store = await api.call<{ publicKey: string }>(
      'GET',
      `${storePath(owner)}/push-key`,
      owner,
    );
    const platform = await api.call<{ publicKey: string }>(
      'GET',
      '/platform/notifications/push-key',
      team,
    );

    expect(store.body.publicKey).toBe(PUBLIC_KEY);
    expect(platform.body.publicKey).toBe(PUBLIC_KEY);
  });

  it('rechaza un endpoint que no es de un servicio push conocido', async () => {
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://localhost:5432/',
    ]) {
      const { status } = await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, {
        ...browser(),
        endpoint,
      });

      expect(status).toBe(400);
    }
  });

  it('no deja suscribirse a la bandeja de una tienda ajena ni a la consola sin serlo', async () => {
    const foreign = await api.call(
      'PUT',
      `${storePath(owner)}/push-subscriptions`,
      otherOwner,
      browser(),
    );
    const platform = await api.call(
      'PUT',
      '/platform/notifications/push-subscriptions',
      owner,
      browser(),
    );

    expect(foreign.status).toBe(403);
    expect(platform.status).toBe(403);
  });

  it('manda el aviso de la tienda a quien se suscribió a esa bandeja, y solo eso', async () => {
    const mine = browser();
    const theirs = browser();

    expect(
      (await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, mine)).status,
    ).toBe(204);
    expect(
      (await api.call('PUT', `${storePath(otherOwner)}/push-subscriptions`, otherOwner, theirs))
        .status,
    ).toBe(204);

    await notifications.notifyStore(owner.storeId, orderPaid(7));
    await settle();

    const [delivered] = push.to(mine.endpoint);

    expect(push.to(mine.endpoint)).toHaveLength(1);
    expect(push.to(theirs.endpoint)).toHaveLength(0);

    // Viaja el aviso de la bandeja, tal cual: ids, número y total.
    expect(JSON.parse(delivered?.payload ?? 'null')).toEqual({
      id: expect.any(String),
      type: 'ORDER_PAID',
      data: { orderId: ORDER_ID, number: 7, total: 89900 },
      readAt: null,
      createdAt: expect.any(String),
    });
  });

  it('la consola y la tienda son bandejas aparte, aunque sea el mismo navegador', async () => {
    const device = browser();

    await api.call('PUT', '/platform/notifications/push-subscriptions', team, device);

    await notifications.notifyStore(team.storeId, orderPaid(8));
    await settle();
    expect(push.to(device.endpoint)).toHaveLength(0);

    // El mismo navegador también pide los de su tienda: ahora llegan los dos.
    await api.call('PUT', `${storePath(team)}/push-subscriptions`, team, device);
    await notifications.notifyStore(team.storeId, orderPaid(9));
    await notifications.notifyPlatform({
      type: 'USER_REGISTERED',
      data: { userId: '33333333-3333-4333-8333-333333333333', storeId: null, storeName: null },
    });
    await settle();

    expect(push.to(device.endpoint).map((entry) => JSON.parse(entry.payload).type)).toEqual(
      expect.arrayContaining(['ORDER_PAID', 'USER_REGISTERED']),
    );
  });

  it('suscribirse dos veces no manda dos veces', async () => {
    const device = browser();

    await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, device);
    await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, device);
    await notifications.notifyStore(owner.storeId, orderPaid(10));
    await settle();

    expect(push.to(device.endpoint)).toHaveLength(1);
  });

  it('si el navegador cambia de cuenta, la anterior deja de recibir', async () => {
    const shared = browser();

    await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, shared);
    await api.call('PUT', `${storePath(otherOwner)}/push-subscriptions`, otherOwner, shared);

    await notifications.notifyStore(owner.storeId, orderPaid(11));
    await settle();

    expect(push.to(shared.endpoint)).toHaveLength(0);
  });

  it('al desactivar, deja de recibir', async () => {
    const device = browser();

    await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, device);

    const { status } = await api.call('DELETE', `${storePath(owner)}/push-subscriptions`, owner, {
      endpoint: device.endpoint,
    });

    expect(status).toBe(204);

    await notifications.notifyStore(owner.storeId, orderPaid(12));
    await settle();

    expect(push.to(device.endpoint)).toHaveLength(0);
  });

  it('un navegador que ya no existe se borra y no se le vuelve a mandar', async () => {
    const device = browser();

    await api.call('PUT', `${storePath(owner)}/push-subscriptions`, owner, device);
    push.gone.add(device.endpoint);

    await notifications.notifyStore(owner.storeId, orderPaid(13));
    await settle();
    await notifications.notifyStore(owner.storeId, orderPaid(14));
    await settle();

    expect(push.to(device.endpoint)).toHaveLength(1);
  });
});
