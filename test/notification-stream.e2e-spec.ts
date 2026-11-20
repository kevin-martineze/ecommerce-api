import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '@modules/notifications/providers/notifications.service';
import { STREAM_TICKET_AUDIENCE } from '@modules/notifications/providers/stream-tickets.service';
import { InMemoryNotificationBus, NotificationBus } from '@shared/notifications/notification-bus';
import { StoreNotificationEvent } from '@shared/notifications/notification-events';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * El stream de avisos contra un puerto de verdad: `inject` espera a que la
 * respuesta termine, y esta no termina.
 *
 * Las llamadas al stream van SIN el secreto del frontend, como las haría el
 * navegador: es la única ruta que tiene que aceptarlas.
 */

jest.setTimeout(60_000);

interface Ticket {
  url: string;
  ticket: string;
  expiresAt: string;
}

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

const ORDER_ID = '44444444-4444-4444-8444-444444444444';

function orderPaid(number: number): StoreNotificationEvent {
  return { type: 'ORDER_PAID', data: { orderId: ORDER_ID, number, total: 89900 } };
}

/** Lee un stream SSE de a pedazos y deja esperar por un evento. */
class StreamReader {
  private buffer = '';
  private readonly frames: Frame[] = [];
  private readonly waiters: (() => void)[] = [];
  raw = '';

  constructor(
    readonly response: Response,
    private readonly abort: AbortController,
  ) {
    void this.pump();
  }

  private async pump(): Promise<void> {
    const body = this.response.body;

    if (!body) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        const text = decoder.decode(value, { stream: true });

        this.raw += text;
        this.buffer += text;

        let end = this.buffer.indexOf('\n\n');

        while (end !== -1) {
          this.frames.push(parseFrame(this.buffer.slice(0, end)));
          this.buffer = this.buffer.slice(end + 2);
          end = this.buffer.indexOf('\n\n');
        }

        this.waiters.splice(0).forEach((wake) => wake());
      }
    } catch {
      // Abortado por la prueba.
    }
  }

  /** Espera hasta tener `count` eventos de ese tipo y los devuelve. */
  async notifications(
    count: number,
    timeoutMs = 3_000,
    event: 'notification' | 'missed' = 'notification',
  ): Promise<Frame[]> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = this.frames.filter((frame) => frame.event === event);

      if (found.length >= count) return found;

      const left = deadline - Date.now();

      if (left <= 0) return found;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);

        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.abort.abort();
  }
}

function parseFrame(block: string): Frame {
  const frame: Frame = {};

  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');

    if (colon <= 0) continue;

    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).trimStart();

    if (field === 'id') frame.id = value;
    if (field === 'event') frame.event = value;
    if (field === 'data') frame.data = value;
  }

  return frame;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Stream de avisos (e2e)', () => {
  let api: TestApp;
  let base: string;
  let owner: Session;
  let otherOwner: Session;
  let team: Session;
  let ownerId: string;
  let otherId: string;
  let notifications: NotificationsService;
  let jwt: JwtService;
  const open: StreamReader[] = [];

  const userId = (email: string) =>
    api.withOwner(async (client) => {
      const { rows } = await client.query<{ id: string }>('select id from users where email = $1', [
        email,
      ]);

      return rows[0]?.id ?? '';
    });

  const storeTicket = async (session: Session = owner) =>
    (
      await api.call<Ticket>(
        'POST',
        `/stores/${session.storeId}/notifications/stream-ticket`,
        session,
        {},
      )
    ).body;

  /** El stream, como lo abre el navegador: sin secreto del frontend. */
  const connect = async (query: string): Promise<StreamReader> => {
    const abort = new AbortController();
    const response = await fetch(`${base}/notifications/stream?${query}`, {
      signal: abort.signal,
      headers: { origin: 'https://luna.otro-dominio.test' },
    });
    const reader = new StreamReader(response, abort);

    open.push(reader);

    return reader;
  };

  beforeAll(async () => {
    api = await startTestApp();
    base = await api.listen();
    notifications = api.get(NotificationsService);
    jwt = api.get(JwtService);

    owner = await api.register('stream-duena');
    otherOwner = await api.register('stream-otra');
    team = await api.register('stream-equipo');

    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        team.email,
      ]),
    );

    [ownerId, otherId] = await Promise.all([userId(owner.email), userId(otherOwner.email)]);
  });

  afterEach(() => {
    open.splice(0).forEach((reader) => reader.close());
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('el ticket', () => {
    it('lo emite el panel con la sesión, apuntando al stream', async () => {
      const { status, body } = await api.call<Ticket>(
        'POST',
        `/stores/${owner.storeId}/notifications/stream-ticket`,
        owner,
        {},
      );

      expect(status).toBe(200);
      expect(body.url).toMatch(/\/notifications\/stream$/);
      expect(body.ticket.length).toBeGreaterThan(20);
      expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    });

    it('no se emite para una tienda ajena ni para la consola sin serlo', async () => {
      const foreign = await api.call(
        'POST',
        `/stores/${owner.storeId}/notifications/stream-ticket`,
        otherOwner,
        {},
      );
      const platform = await api.call('POST', '/platform/notifications/stream-ticket', owner, {});

      expect(foreign.status).toBe(403);
      expect(platform.status).toBe(403);
    });

    it('no sirve como sesión del panel', async () => {
      const { ticket } = await storeTicket();
      const { status } = await api.call('GET', `/stores/${owner.storeId}/notifications`, {
        token: ticket,
      });

      expect(status).toBe(401);
    });
  });

  describe('quién abre el stream', () => {
    it('sin ticket, 401', async () => {
      expect((await api.withoutSecret('GET', '/notifications/stream')).status).toBe(401);
    });

    it('un access token no sirve de ticket', async () => {
      const stream = await connect(`ticket=${owner.token}`);

      expect(stream.response.status).toBe(401);
    });

    it('un ticket vencido, 401', async () => {
      const expired = await jwt.signAsync(
        {
          sub: ownerId,
          scope: `store:${owner.storeId}`,
          exp: Math.floor(Date.now() / 1000) - 5,
        },
        { audience: STREAM_TICKET_AUDIENCE },
      );
      const stream = await connect(`ticket=${expired}`);

      expect(stream.response.status).toBe(401);
    });

    it('un ticket de una tienda donde ya no es miembro, 403', async () => {
      // Como si la hubieran quitado de la tienda después de emitirlo.
      const stale = await jwt.signAsync(
        { sub: otherId, scope: `store:${owner.storeId}` },
        { audience: STREAM_TICKET_AUDIENCE, expiresIn: 60 },
      );
      const stream = await connect(`ticket=${stale}`);

      expect(stream.response.status).toBe(403);
    });
  });

  describe('en vivo', () => {
    it('abre sin secreto del frontend, desde cualquier origen, sin comprimir', async () => {
      const { ticket } = await storeTicket();
      const stream = await connect(`ticket=${ticket}`);

      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
      expect(stream.response.headers.get('access-control-allow-origin')).toBe('*');
      expect(stream.response.headers.get('content-encoding')).toBeNull();

      await sleep(50);
      expect(stream.raw).toMatch(/^retry: 5000\n\n/);
    });

    it('un aviso nuevo llega a la dueña conectada, y no a otra tienda', async () => {
      const mine = await connect(`ticket=${(await storeTicket()).ticket}`);
      const theirs = await connect(`ticket=${(await storeTicket(otherOwner)).ticket}`);

      await sleep(50);
      await notifications.notifyStore(owner.storeId, orderPaid(1));

      const [frame] = await mine.notifications(1);

      expect(frame?.id).toBeDefined();
      expect(JSON.parse(frame?.data ?? 'null')).toMatchObject({
        id: frame?.id,
        type: 'ORDER_PAID',
        readAt: null,
        data: { number: 1 },
      });
      expect(await theirs.notifications(1, 300)).toEqual([]);
    });

    it('al reconectar con `after`, reenvía en orden lo que se perdió y nada más', async () => {
      const first = await connect(`ticket=${(await storeTicket()).ticket}`);

      await sleep(50);
      await notifications.notifyStore(owner.storeId, orderPaid(10));

      const [seen] = await first.notifications(1);

      first.close();

      // Desconectada: dos pedidos pagados.
      await notifications.notifyStore(owner.storeId, orderPaid(11));
      await notifications.notifyStore(owner.storeId, orderPaid(12));

      const again = await connect(`ticket=${(await storeTicket()).ticket}&after=${seen?.id}`);
      const replayed = await again.notifications(2, 3_000, 'missed');

      expect(replayed.map((frame) => JSON.parse(frame.data ?? 'null').data.number)).toEqual([
        11, 12,
      ]);
    });

    it('un `after` mal formado no rompe la conexión', async () => {
      const stream = await connect(`ticket=${(await storeTicket()).ticket}&after=basura`);

      expect(stream.response.status).toBe(200);
    });

    it('al cerrar la pestaña, se desuscribe del bus', async () => {
      const bus = api.get(NotificationBus);

      if (!(bus instanceof InMemoryNotificationBus)) {
        throw new Error('Esta prueba supone el bus en memoria.');
      }

      // Las conexiones de las pruebas anteriores terminan de cerrarse.
      await sleep(200);

      const before = bus.openChannels;
      const stream = await connect(`ticket=${(await storeTicket()).ticket}`);

      await sleep(50);
      expect(bus.openChannels).toBe(before + 1);

      stream.close();
      await sleep(100);

      expect(bus.openChannels).toBe(before);
    });

    it('la consola recibe los avisos de la plataforma', async () => {
      const { body } = await api.call<Ticket>(
        'POST',
        '/platform/notifications/stream-ticket',
        team,
        {},
      );
      const stream = await connect(`ticket=${body.ticket}`);

      await sleep(50);
      await notifications.notifyPlatform({
        type: 'USER_REGISTERED',
        data: { userId: ownerId, storeId: null, storeName: null },
      });

      const [frame] = await stream.notifications(1);

      expect(JSON.parse(frame?.data ?? 'null')).toMatchObject({ type: 'USER_REGISTERED' });
    });
  });
});
