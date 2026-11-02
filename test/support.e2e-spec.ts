import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Centro de soporte de punta a punta: la dueña abre y sigue sus casos, el
 * equipo los responde, y ninguna tienda ve los de otra.
 */

jest.setTimeout(60_000);

interface Message {
  id: string;
  author: 'OWNER' | 'TEAM';
  body: string;
  createdAt: string;
}

interface StoreTicket {
  id: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  unreadReplies: number;
}

interface StoreList {
  tickets: StoreTicket[];
  unreadReplies: number;
}

interface StoreThread {
  ticket: StoreTicket;
  messages: Message[];
}

interface PlatformTicket {
  id: string;
  storeId: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  unreadFromOwner: number;
  waitingSince: string | null;
}

interface PlatformList {
  tickets: PlatformTicket[];
  total: number;
}

const VALID_CASE = {
  subject: 'No me llega el correo de pago',
  category: 'PAYMENTS',
  body: 'Hice un pago de prueba y la cuenta no se refleja en el panel.',
};

describe('Centro de soporte (e2e)', () => {
  let api: TestApp;
  let owner: Session;
  let otherOwner: Session;
  let team: Session;

  const panel = <T>(
    method: 'GET' | 'POST',
    url: string,
    session: Session = owner,
    payload?: object,
  ) => api.call<T>(method, `/stores/${session.storeId}/support${url}`, session, payload);

  const platform = <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    api.call<T>(method, `/platform/support${url}`, team, payload);

  beforeAll(async () => {
    api = await startTestApp();
    owner = await api.register('soporte-duena');
    otherOwner = await api.register('soporte-otra');
    team = await api.register('soporte-equipo');

    // La única puerta a `platform_admins` es la base (ver scripts/grant-platform-admin.ts).
    await api.withOwner((client) =>
      client.query(`insert into platform_admins (user_id) select id from users where email = $1`, [
        team.email,
      ]),
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('acceso', () => {
    it('sin sesión no entra a ninguna de las dos superficies', async () => {
      expect((await api.call('GET', `/stores/${owner.storeId}/support/tickets`)).status).toBe(401);
      expect((await api.call('GET', '/platform/support/tickets')).status).toBe(401);
    });

    it('una dueña no entra a la bandeja del equipo', async () => {
      const { status } = await api.call('GET', '/platform/support/tickets', owner);

      expect(status).toBe(403);
    });

    it('una cuenta de otra tienda no nombra la tienda ajena', async () => {
      const { status } = await api.call(
        'GET',
        `/stores/${owner.storeId}/support/tickets`,
        otherOwner,
      );

      expect(status).toBe(403);
    });
  });

  describe('la dueña', () => {
    let ticketId: string;

    it('abre un caso y el primer mensaje queda como suyo', async () => {
      const { status, body } = await panel<StoreThread>('POST', '/tickets', owner, VALID_CASE);

      expect(status).toBe(201);
      expect(body.ticket).toMatchObject({
        subject: VALID_CASE.subject,
        status: 'OPEN',
        unreadReplies: 0,
      });
      expect(body.messages).toEqual([
        expect.objectContaining({ author: 'OWNER', body: VALID_CASE.body }),
      ]);

      ticketId = body.ticket.id;
    });

    it('rechaza un caso sin asunto válido o con categoría inventada', async () => {
      const short = await panel('POST', '/tickets', owner, { ...VALID_CASE, subject: 'ab' });
      const unknown = await panel('POST', '/tickets', owner, { ...VALID_CASE, category: 'OTRO' });

      expect(short.status).toBe(400);
      expect(unknown.status).toBe(400);
    });

    it('no ve los casos de otra tienda, ni por su id', async () => {
      const list = await panel<StoreList>('GET', '/tickets', otherOwner);

      expect(list.body.tickets.map((ticket) => ticket.id)).not.toContain(ticketId);

      // Con su propio storeId en la ruta, el caso ajeno simplemente no existe.
      const { status } = await api.call(
        'GET',
        `/stores/${otherOwner.storeId}/support/tickets/${ticketId}`,
        otherOwner,
      );

      expect(status).toBe(404);
    });

    it('ve el equipo respondiendo como respuesta nueva, y al abrir el hilo se apaga', async () => {
      const reply = await platform<PlatformList>('GET', '/tickets');

      expect(reply.status).toBe(200);

      const answer = await api.call<StoreThread>(
        'GET',
        `/platform/support/stores/${owner.storeId}/tickets/${ticketId}`,
        team,
      );

      expect(answer.status).toBe(200);

      const replied = await api.call(
        'POST',
        `/platform/support/stores/${owner.storeId}/tickets/${ticketId}/messages`,
        team,
        { body: 'Revisamos tu cuenta. Ya quedó reflejado el pago.' },
      );

      expect(replied.status).toBe(201);

      const before = await panel<StoreList>('GET', '/tickets');

      expect(before.body.unreadReplies).toBe(1);

      await panel<StoreThread>('GET', `/tickets/${ticketId}`);

      const after = await panel<StoreList>('GET', '/tickets');

      expect(after.body.unreadReplies).toBe(0);
    });

    it('al escribir de nuevo, el caso vuelve a esperar al equipo', async () => {
      const { status, body } = await panel<StoreThread>(
        'POST',
        `/tickets/${ticketId}/messages`,
        owner,
        {
          body: 'Gracias, ya lo veo. Sigo con una duda más.',
        },
      );

      expect(status).toBe(201);
      expect(body.ticket.status).toBe('OPEN');
      expect(body.messages.at(-1)).toMatchObject({ author: 'OWNER' });
    });
  });

  describe('el equipo', () => {
    let ticketId: string;

    beforeAll(async () => {
      const opened = await panel<StoreThread>('POST', '/tickets', owner, {
        ...VALID_CASE,
        subject: 'Caso para la bandeja del equipo',
      });

      ticketId = opened.body.ticket.id;
    });

    it('la bandeja muestra el caso con su tienda y lo que espera', async () => {
      const { status, body } = await platform<PlatformList>(
        'GET',
        `/tickets?q=bandeja%20del%20equipo`,
      );

      expect(status).toBe(200);
      const row = body.tickets.find((ticket) => ticket.id === ticketId);

      expect(row).toMatchObject({ storeId: owner.storeId, status: 'OPEN', unreadFromOwner: 1 });
      expect(row?.waitingSince).not.toBeNull();
    });

    it('filtra por estado en la URL', async () => {
      const { body } = await platform<PlatformList>('GET', '/tickets?status=CLOSED');

      expect(body.tickets.every((ticket) => ticket.status === 'CLOSED')).toBe(true);
    });

    it('responder deja el caso en ANSWERED y cerrarlo lo saca de la espera', async () => {
      await platform('POST', `/stores/${owner.storeId}/tickets/${ticketId}/messages`, {
        body: 'Ya lo revisamos y quedó resuelto.',
      });

      const answered = await platform<PlatformList>('GET', '/tickets?q=bandeja%20del%20equipo');

      expect(answered.body.tickets.find((ticket) => ticket.id === ticketId)?.status).toBe(
        'ANSWERED',
      );

      const closed = await platform<{ ticket: PlatformTicket }>(
        'PATCH',
        `/stores/${owner.storeId}/tickets/${ticketId}`,
        { status: 'CLOSED' },
      );

      expect(closed.status).toBe(200);
      expect(closed.body.ticket).toMatchObject({ status: 'CLOSED', waitingSince: null });
    });
  });
});
