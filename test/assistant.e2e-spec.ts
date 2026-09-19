import { Assistant, AssistantAnswer, AssistantRequest } from '@shared/ai/assistant';

import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * El asistente de una tienda: quién lo tiene, qué puede consultar y cuándo se
 * le acaba.
 *
 * El modelo se reemplaza por un doble que llama a las herramientas y devuelve
 * lo que le dieron. Así se prueba lo que es nuestro —el plan, el tope del mes,
 * el aislamiento entre tiendas— sin pagar ni depender de que un modelo redacte
 * igual dos veces.
 */

jest.setTimeout(60_000);

interface Reply {
  reply: string;
  handoff: boolean;
  remaining: number;
  error?: string;
}

/** Un modelo de mentira: pide la herramienta que le digan y repite el resultado. */
class DobleAsistente extends Assistant {
  readonly available = true;

  /** Lo último que devolvieron las herramientas, para mirarlo desde la prueba. */
  ultimo: unknown = null;

  constructor(
    private readonly tool: string,
    private readonly input: unknown = {},
  ) {
    super();
  }

  async answer(request: AssistantRequest): Promise<AssistantAnswer> {
    this.ultimo = await request.run(this.tool, this.input);

    return {
      text: JSON.stringify(this.ultimo),
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  }
}

describe('Asistente de la tienda (e2e)', () => {
  let api: TestApp;
  let doble: DobleAsistente;
  let shop: Session;

  const preguntar = (slug: string, texto: string) =>
    api.call<Reply>('POST', `/public/${slug}/assistant`, undefined, {
      messages: [{ role: 'user', content: texto }],
    });

  /** El plan decide quién tiene asistente; se cambia como lo haría la consola. */
  const ponerPlan = (session: Session, code: string) =>
    api.withOwner(async (client) => {
      await client.query('begin');
      await client.query(`select set_config('app.store_id', $1, true)`, [session.storeId]);
      await client.query('update subscriptions set plan_code = $2 where store_id = $1', [
        session.storeId,
        code,
      ]);
      await client.query('commit');
    });

  beforeAll(async () => {
    doble = new DobleAsistente('ver_envios');
    api = await startTestApp({ assistant: doble });
    shop = await api.register('asistente');
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('quién lo tiene', () => {
    it('el plan básico no trae asistente, y la tienda no lo ofrece', async () => {
      const { status, body } = await preguntar(shop.slug, '¿hacen envíos a Cali?');

      expect(status).toBe(403);
      expect(body.error).toBe('ai_disabled');

      const vitrina = await api.call<{ settings: { assistant: boolean } }>(
        'GET',
        `/public/${shop.slug}`,
      );

      expect(vitrina.body.settings.assistant).toBe(false);
    });

    it('con un plan que lo incluye, la tienda lo ofrece y responde', async () => {
      await ponerPlan(shop, 'impulso');

      const vitrina = await api.call<{ settings: { assistant: boolean } }>(
        'GET',
        `/public/${shop.slug}`,
      );

      expect(vitrina.body.settings.assistant).toBe(true);

      const { status, body } = await preguntar(shop.slug, '¿hacen envíos a Cali?');

      expect(status).toBe(201);
      expect(body.remaining).toBeGreaterThan(0);
    });
  });

  describe('lo que puede consultar', () => {
    it('las herramientas solo ven la tienda que pregunta', async () => {
      const otra = await api.register('asistente-otra');

      await ponerPlan(otra, 'impulso');
      await api.call('POST', `/stores/${otra.storeId}/sizes`, otra, { label: 'UNICA' });

      const buscador = new DobleAsistente('buscar_prendas', { texto: 'vestido' });
      const propia = await startTestApp({ assistant: buscador });

      try {
        // Una prenda de la primera tienda, que la segunda no puede ver.
        await propia.call('POST', `/stores/${shop.storeId}/products`, shop, {
          name: 'Vestido secreto',
          basePrice: 120000,
          status: 'ACTIVE',
        });

        await propia.call<Reply>('POST', `/public/${shop.slug}/assistant`, undefined, {
          messages: [{ role: 'user', content: '¿tienen vestidos?' }],
        });

        const desdeSuTienda = JSON.stringify(buscador.ultimo);

        expect(desdeSuTienda).toContain('Vestido secreto');

        await propia.call<Reply>('POST', `/public/${otra.slug}/assistant`, undefined, {
          messages: [{ role: 'user', content: '¿tienen vestidos?' }],
        });

        expect(JSON.stringify(buscador.ultimo)).not.toContain('Vestido secreto');
      } finally {
        await propia.close();
      }
    });
  });

  describe('el tope del mes', () => {
    it('agotada la cuota, deja de responder y lo dice', async () => {
      const cuota = 2;

      await api.withOwner((client) =>
        client.query('update plans set ai_replies_per_month = $1 where code = $2', [
          cuota,
          'impulso',
        ]),
      );

      // El mes arranca limpio para esta tienda: las pruebas de arriba ya
      // gastaron respuestas.
      await api.withOwner(async (client) => {
        await client.query('begin');
        await client.query(`select set_config('app.store_id', $1, true)`, [shop.storeId]);
        await client.query('delete from ai_replies where store_id = $1', [shop.storeId]);
        await client.query('commit');
      });

      try {
        for (let i = 0; i < cuota; i += 1) {
          const { body } = await preguntar(shop.slug, '¿y el envío?');

          expect(body.remaining).toBeLessThan(cuota);
        }

        const pasada = await preguntar(shop.slug, 'una más');

        expect(pasada.status).toBe(403);
        expect(pasada.body.error).toBe('plan_limit');
      } finally {
        await api.withOwner((client) =>
          client.query(`update plans set ai_replies_per_month = 500 where code = 'impulso'`),
        );
      }
    });
  });

  describe('lo que no se guarda', () => {
    it('queda el consumo, nunca la conversación', async () => {
      const filas = await api.withOwner(async (client) => {
        const { rows } = await client.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_name = 'ai_replies'`,
        );

        return rows.map((row) => row.column_name);
      });

      // Son conversaciones de las clientas de la tienda: para contar y medir
      // bastan los tokens.
      expect(filas.sort()).toEqual(
        ['created_at', 'id', 'input_tokens', 'output_tokens', 'store_id'].sort(),
      );
    });
  });
});
