import { DomainProviderError } from './domain-provider';
import { ownershipName, ownershipValue, TxtResolver } from './ownership';
import { VercelDomainProvider } from './vercel-domain-provider';

/** Una respuesta de Vercel de mentira: estado y cuerpo JSON. */
interface Reply {
  status: number;
  body?: unknown;
}

interface Call {
  method: string;
  path: string;
  body: unknown;
  teamId: string | null;
  authorization: string | null;
}

const PROJECT = 'prj_test';

/**
 * Un `fetch` simulado: cada ruta "MÉTODO path" responde lo que el test diga.
 * Si una ruta no está en el mapa, responde 500, para que un test que llame a
 * algo inesperado falle en vez de pasar en silencio.
 */
function fakeVercel(routes: Record<string, Reply>) {
  const calls: Call[] = [];

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';

    calls.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      teamId: url.searchParams.get('teamId'),
      authorization: new Headers(init?.headers).get('authorization'),
    });

    const reply: Reply = routes[`${method} ${url.pathname}`] ?? {
      status: 500,
      body: { error: 'ruta no simulada' },
    };

    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}

/** Un DNS con los TXT que existan. Sin entrada, NXDOMAIN. */
function fakeDns(records: Record<string, string[][]>): TxtResolver {
  return {
    resolveTxt: (name) =>
      records[name] ? Promise.resolve(records[name]) : Promise.reject(new Error('ENODATA')),
  };
}

const enProyecto = (path: string, verified: boolean, verification: unknown[] = []) => ({
  [`GET ${path}`]: { status: 200, body: { verified, verification } },
});

const configOk = (path: string, extra: Record<string, unknown> = {}) => ({
  [`GET ${path}`]: {
    status: 200,
    body: {
      misconfigured: false,
      recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
      recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
      ...extra,
    },
  },
});

const SUB = 'www.tienda.com';
const APEX = 'tienda.com';
const subPath = `/v9/projects/${PROJECT}/domains/${SUB}`;
const apexPath = `/v9/projects/${PROJECT}/domains/${APEX}`;

describe('VercelDomainProvider', () => {
  const token = 'tok_de_prueba_largo';

  function provider(
    routes: Record<string, Reply>,
    txt: TxtResolver = fakeDns({}),
    teamId?: string,
  ) {
    const vercel = fakeVercel(routes);
    const driver = new VercelDomainProvider({
      token,
      projectId: PROJECT,
      teamId,
      fetch: vercel.fetch,
      txt,
    });

    return { driver, calls: vercel.calls };
  }

  describe('add', () => {
    it('da de alta el dominio en el proyecto, con el token en la cabecera', async () => {
      const { driver, calls } = provider({
        [`GET ${subPath}`]: { status: 404 },
        [`POST /v10/projects/${PROJECT}/domains`]: { status: 200, body: { verified: false } },
      });

      await driver.add(SUB);

      const post = calls.find((call) => call.method === 'POST');

      expect(post?.body).toEqual({ name: SUB });
      expect(post?.authorization).toBe(`Bearer ${token}`);
    });

    it('si el dominio ya está en el proyecto, no vuelve a darlo de alta', async () => {
      const { driver, calls } = provider({
        ...enProyecto(subPath, false),
      });

      await driver.add(SUB);

      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('un dominio de otro proyecto de Vercel es "taken"', async () => {
      const { driver } = provider({
        [`GET ${subPath}`]: { status: 404 },
        [`POST /v10/projects/${PROJECT}/domains`]: { status: 409 },
      });

      await expect(driver.add(SUB)).rejects.toMatchObject({ kind: 'taken' });
    });

    it('un dominio que Vercel no acepta es "invalid"', async () => {
      const { driver } = provider({
        [`GET ${subPath}`]: { status: 404 },
        [`POST /v10/projects/${PROJECT}/domains`]: { status: 400 },
      });

      await expect(driver.add(SUB)).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('si Vercel no responde, es "unavailable"', async () => {
      const failing = (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;
      const driver = new VercelDomainProvider({ token, projectId: PROJECT, fetch: failing });

      await expect(driver.add(SUB)).rejects.toBeInstanceOf(DomainProviderError);
      await expect(driver.add(SUB)).rejects.toMatchObject({ kind: 'unavailable' });
    });
  });

  describe('inspect', () => {
    it('un subdominio: el CNAME de la recomendación y, si pide TXT, lo incluye', async () => {
      const { driver } = provider({
        ...configOk(`/v6/domains/${SUB}/config`),
        ...enProyecto(subPath, true, [
          {
            type: 'TXT',
            domain: `_vercel.${SUB}`,
            reason: 'dominio en otra cuenta',
            value: 'vc-x',
          },
          { type: 'HTTP', domain: SUB, reason: 'x', value: 'y' },
        ]),
      });

      const inspection = await driver.inspect(SUB);

      expect(inspection.configured).toBe(true);
      expect(inspection.error).toBeNull();
      expect(inspection.records).toEqual([
        { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' },
        { type: 'TXT', name: '_vercel.www', value: 'vc-x' },
      ]);
    });

    it('la raíz: el A de la recomendación, sin TXT extra si no lo pide', async () => {
      const { driver } = provider({
        ...configOk(`/v6/domains/${APEX}/config`),
        ...enProyecto(apexPath, true),
      });

      const inspection = await driver.inspect(APEX);

      expect(inspection.records).toEqual([{ type: 'A', name: '@', value: '76.76.21.21' }]);
      expect(inspection.configured).toBe(true);
    });

    it('si el DNS no apunta a Vercel, no está configurado y lo dice', async () => {
      const { driver } = provider({
        ...configOk(`/v6/domains/${SUB}/config`, { misconfigured: true }),
        ...enProyecto(subPath, true),
      });

      const inspection = await driver.inspect(SUB);

      expect(inspection.configured).toBe(false);
      expect(inspection.error).toMatch(/enrutamiento/);
    });

    it('si Vercel todavía no verificó el dominio, no está configurado', async () => {
      const { driver } = provider({
        ...configOk(`/v6/domains/${SUB}/config`),
        ...enProyecto(subPath, false),
      });

      const inspection = await driver.inspect(SUB);

      expect(inspection.configured).toBe(false);
      expect(inspection.error).toMatch(/verificó/);
    });

    it('fuera del proyecto, el dominio cuenta como no verificado, no como error', async () => {
      const { driver } = provider({
        ...configOk(`/v6/domains/${SUB}/config`),
        [`GET ${subPath}`]: { status: 404 },
      });

      const inspection = await driver.inspect(SUB);

      expect(inspection.configured).toBe(false);
    });

    it('una respuesta con otra forma es "unavailable", no datos inventados', async () => {
      const { driver } = provider({
        [`GET /v6/domains/${SUB}/config`]: { status: 200, body: { nada: true } },
        ...enProyecto(subPath, true),
      });

      await expect(driver.inspect(SUB)).rejects.toMatchObject({ kind: 'unavailable' });
    });
  });

  describe('verifyOwnership', () => {
    it('sin el TXT de Globerce, no le pregunta nada a Vercel', async () => {
      const { driver, calls } = provider({}, fakeDns({}));

      await expect(driver.verifyOwnership(SUB, 'tok')).resolves.toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('con el TXT de Globerce y el desafío de Vercel aceptado, está verificado', async () => {
      const txt = fakeDns({ [ownershipName(SUB)]: [[ownershipValue('tok')]] });
      const { driver } = provider(
        { [`POST ${subPath}/verify`]: { status: 200, body: { verified: true } } },
        txt,
      );

      await expect(driver.verifyOwnership(SUB, 'tok')).resolves.toBe(true);
    });

    it('si Vercel todavía no ve su desafío (400), no está verificado y no es un error', async () => {
      const txt = fakeDns({ [ownershipName(SUB)]: [[ownershipValue('tok')]] });
      const { driver } = provider({ [`POST ${subPath}/verify`]: { status: 400 } }, txt);

      await expect(driver.verifyOwnership(SUB, 'tok')).resolves.toBe(false);
    });

    it('un 500 de Vercel en la verificación es "unavailable"', async () => {
      const txt = fakeDns({ [ownershipName(SUB)]: [[ownershipValue('tok')]] });
      const { driver } = provider({ [`POST ${subPath}/verify`]: { status: 500 } }, txt);

      await expect(driver.verifyOwnership(SUB, 'tok')).rejects.toMatchObject({
        kind: 'unavailable',
      });
    });
  });

  describe('remove', () => {
    it('quita el dominio del proyecto', async () => {
      const { driver, calls } = provider({ [`DELETE ${subPath}`]: { status: 200 } });

      await driver.remove(SUB);

      expect(calls[0]?.method).toBe('DELETE');
    });

    it('quitar uno que ya no está en el proyecto no es un error', async () => {
      const { driver } = provider({ [`DELETE ${subPath}`]: { status: 404 } });

      await expect(driver.remove(SUB)).resolves.toBeUndefined();
    });

    it('un fallo de Vercel al quitar es "unavailable"', async () => {
      const { driver } = provider({ [`DELETE ${subPath}`]: { status: 503 } });

      await expect(driver.remove(SUB)).rejects.toMatchObject({ kind: 'unavailable' });
    });
  });

  it('con equipo, todas las llamadas llevan teamId', async () => {
    const { driver, calls } = provider(
      { [`DELETE ${subPath}`]: { status: 200 } },
      undefined,
      'team_x',
    );

    await driver.remove(SUB);

    expect(calls[0]?.teamId).toBe('team_x');
  });
});
