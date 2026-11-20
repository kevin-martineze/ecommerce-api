import { NotificationsService } from '@modules/notifications/providers/notifications.service';
import { NotificationDto } from '@shared/dtos/notifications/notifications.dto';
import {
  NotificationBus,
  platformChannel,
  storeChannel,
} from '@shared/notifications/notification-bus';
import {
  PlatformNotificationEvent,
  StoreNotificationEvent,
} from '@shared/notifications/notification-events';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Bandeja de avisos de punta a punta: a quién le llega cada uno, que ninguna
 * tienda vea los de otra y que lo leído sea de cada persona.
 *
 * Los disparadores reales (pedidos, registro, cobros) llegan en la fase 2; acá
 * se publica directo con el servicio, que es lo que ellos van a llamar.
 */

jest.setTimeout(60_000);

interface Item {
  id: string;
  type: string;
  readAt: string | null;
  data: Record<string, unknown>;
}

interface List {
  items: Item[];
  unread: number;
  nextBefore: string | null;
}

const ORDER_ID = '44444444-4444-4444-8444-444444444444';

function orderPaid(number: number): StoreNotificationEvent {
  return {
    type: 'ORDER_PAID',
    data: { orderId: ORDER_ID, number, total: 89900 },
  };
}

describe('Avisos (e2e)', () => {
  let api: TestApp;
  let notifications: NotificationsService;
  let bus: NotificationBus;
  let owner: Session;
  let staff: Session;
  let otherOwner: Session;
  let team: Session;
  let ownerId: string;
  let staffId: string;
  let teamId: string;

  const userId = (email: string) =>
    api.withOwner(async (client) => {
      const { rows } = await client.query<{ id: string }>('select id from users where email = $1', [
        email,
      ]);

      return rows[0]?.id ?? '';
    });

  const inbox = (session: Session, query = '') =>
    api.call<List>('GET', `/stores/${session.storeId}/notifications${query}`, session);

  beforeAll(async () => {
    api = await startTestApp();
    notifications = api.get(NotificationsService);
    bus = api.get(NotificationBus);

    owner = await api.register('avisos-duena');
    otherOwner = await api.register('avisos-otra');
    team = await api.register('avisos-equipo');

    const personal = await api.register('avisos-personal');

    await api.withOwner(async (client) => {
      await client.query(
        `insert into platform_admins (user_id) select id from users where email = $1`,
        [team.email],
      );
      await client.query(
        `insert into store_members (store_id, user_id, role)
         select $1, id, 'STAFF' from users where email = $2`,
        [owner.storeId, personal.email],
      );
    });

    // El personal entra a la tienda de la dueña con `switch-store`, como en la app.
    const switched = await api.call<{ accessToken: string; refreshToken: string }>(
      'POST',
      '/auth/switch-store',
      personal,
      { storeId: owner.storeId, refreshToken: personal.refreshToken },
    );

    staff = {
      token: switched.body.accessToken,
      refreshToken: switched.body.refreshToken,
      storeId: owner.storeId,
      slug: owner.slug,
      email: personal.email,
    };

    [ownerId, staffId, teamId] = await Promise.all([
      userId(owner.email),
      userId(personal.email),
      userId(team.email),
    ]);
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('acceso', () => {
    it('sin sesión no entra a ninguna bandeja', async () => {
      expect((await api.call('GET', `/stores/${owner.storeId}/notifications`)).status).toBe(401);
      expect((await api.call('GET', '/platform/notifications')).status).toBe(401);
    });

    it('una cuenta de otra tienda no nombra la tienda ajena', async () => {
      const { status } = await api.call(
        'GET',
        `/stores/${owner.storeId}/notifications`,
        otherOwner,
      );

      expect(status).toBe(403);
    });

    it('una dueña no entra a la bandeja de la plataforma', async () => {
      expect((await api.call('GET', '/platform/notifications', owner)).status).toBe(403);
    });
  });

  describe('tienda', () => {
    it('un aviso llega a cada miembro, y solo de esa tienda', async () => {
      await notifications.notifyStore(owner.storeId, orderPaid(1));

      const [mine, theirs, other] = await Promise.all([
        inbox(owner),
        inbox(staff),
        inbox(otherOwner),
      ]);

      expect(mine.status).toBe(200);
      expect(mine.body.unread).toBe(1);
      expect(mine.body.items).toEqual([
        expect.objectContaining({
          type: 'ORDER_PAID',
          readAt: null,
          data: { orderId: ORDER_ID, number: 1, total: 89900 },
        }),
      ]);
      expect(theirs.body.unread).toBe(1);
      expect(other.body.items).toEqual([]);
    });

    it('lo leído es de cada persona', async () => {
      const read = await api.call<{ unread: number }>(
        'POST',
        `/stores/${owner.storeId}/notifications/read`,
        owner,
        {},
      );

      expect(read.status).toBe(200);
      expect(read.body.unread).toBe(0);
      expect((await inbox(owner)).body.items[0]?.readAt).not.toBeNull();
      expect((await inbox(staff)).body.unread).toBe(1);
    });

    it('marca solo los avisos que se nombran', async () => {
      await notifications.notifyStore(owner.storeId, orderPaid(2));
      await notifications.notifyStore(owner.storeId, orderPaid(3));

      const before = await inbox(staff);
      const newest = before.body.items[0];

      expect(before.body.unread).toBe(3);

      const read = await api.call<{ unread: number }>(
        'POST',
        `/stores/${owner.storeId}/notifications/read`,
        staff,
        { ids: [newest?.id] },
      );

      expect(read.body.unread).toBe(2);
    });

    it('no marca avisos de otra persona aunque nombre su id', async () => {
      const staffItem = (await inbox(staff)).body.items.find((item) => item.readAt === null);
      const mineBefore = (await inbox(owner)).body.unread;

      await api.call('POST', `/stores/${otherOwner.storeId}/notifications/read`, otherOwner, {
        ids: [staffItem?.id],
      });

      expect((await inbox(staff)).body.unread).toBe(2);
      expect((await inbox(owner)).body.unread).toBe(mineBefore);
    });

    it('pagina del más nuevo al más viejo sin repetir', async () => {
      const first = await inbox(owner, '?limit=2');

      expect(first.body.items.map((item) => item.data.number)).toEqual([3, 2]);
      expect(first.body.nextBefore).not.toBeNull();

      const second = await inbox(owner, `?limit=2&before=${first.body.nextBefore}`);

      expect(second.body.items.map((item) => item.data.number)).toEqual([1]);
      expect(second.body.nextBefore).toBeNull();
    });

    it('rechaza un cursor que no es un id', async () => {
      expect((await inbox(owner, '?before=abc')).status).toBe(400);
    });

    it('reparte en vivo solo al canal de cada miembro', async () => {
      const toOwner: NotificationDto[] = [];
      const toOther: NotificationDto[] = [];
      const stopOwner = bus.subscribe(storeChannel(owner.storeId, ownerId), (n) => toOwner.push(n));
      const stopOther = bus.subscribe(storeChannel(otherOwner.storeId, ownerId), (n) =>
        toOther.push(n),
      );

      await notifications.notifyStore(owner.storeId, orderPaid(4));

      stopOwner();
      stopOther();

      expect(toOwner).toEqual([expect.objectContaining({ type: 'ORDER_PAID', readAt: null })]);
      expect(toOther).toEqual([]);
    });

    it('un aviso con datos inválidos no se guarda ni lanza', async () => {
      const before = (await inbox(owner)).body.unread;

      await expect(
        notifications.notifyStore(owner.storeId, {
          type: 'ORDER_PAID',
          data: { orderId: 'no-es-uuid', number: 5, total: 1 },
        }),
      ).resolves.toBeUndefined();

      expect((await inbox(owner)).body.unread).toBe(before);
    });

    it('una cuenta deshabilitada no recibe avisos', async () => {
      await api.withOwner((client) =>
        client.query('update users set disabled_at = now() where id = $1', [staffId]),
      );

      await notifications.notifyStore(owner.storeId, orderPaid(6));

      const count = await api.withOwner(async (client) => {
        const { rows } = await client.query<{ total: string }>(
          `select count(*) as total from store_notifications
           where user_id = $1 and data->>'number' = '6'`,
          [staffId],
        );

        return Number(rows[0]?.total);
      });

      await api.withOwner((client) =>
        client.query('update users set disabled_at = null where id = $1', [staffId]),
      );

      expect(count).toBe(0);
    });
  });

  describe('plataforma', () => {
    const STORE_CREATED = (): PlatformNotificationEvent => ({
      type: 'STORE_CREATED',
      data: {
        storeId: otherOwner.storeId,
        storeName: 'Tienda de prueba',
        slug: otherOwner.slug,
        userId: ownerId,
        newAccount: true,
      },
    });

    it('llega a quien administra la plataforma, en vivo y en la bandeja', async () => {
      const live: NotificationDto[] = [];
      const stop = bus.subscribe(platformChannel(teamId), (n) => live.push(n));

      await notifications.notifyPlatform(STORE_CREATED());
      stop();

      const list = await api.call<List>('GET', '/platform/notifications', team);

      expect(list.status).toBe(200);
      expect(list.body.items[0]).toMatchObject({ type: 'STORE_CREATED', readAt: null });
      expect(list.body.unread).toBeGreaterThanOrEqual(1);
      expect(live).toEqual([expect.objectContaining({ type: 'STORE_CREATED' })]);
    });

    it('no llega a la bandeja de ninguna tienda', async () => {
      const count = await api.withOwner(async (client) => {
        const { rows } = await client.query<{ total: string }>(
          `select count(*) as total from store_notifications where type::text = 'STORE_CREATED'`,
        );

        return Number(rows[0]?.total);
      });

      expect(count).toBe(0);
    });

    it('marcar todo deja la bandeja en cero', async () => {
      const read = await api.call<{ unread: number }>(
        'POST',
        '/platform/notifications/read',
        team,
        {},
      );

      expect(read.status).toBe(200);
      expect(read.body.unread).toBe(0);
    });
  });
});
