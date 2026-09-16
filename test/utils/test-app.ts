import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { buildValidationPipe } from '@shared/config/validation-pipe';

import { AppModule } from '../../src/app.module';

/**
 * La API levantada en memoria para los e2e.
 *
 * Usa las mismas reglas que producción (prefijo y pipe de validación) y no abre
 * puertos: las peticiones entran por `inject` de Fastify. Todo lo que se crea
 * con `register` se borra en `close`, así los e2e corren contra la base de
 * desarrollo sin ensuciarla.
 */

/** Métodos que usan los e2e. No es `HTTPMethods` de fastify: ese incluye `QUERY`, que `inject` no acepta. */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Contraseña de toda cuenta de prueba. */
export const TEST_PASSWORD = 'una contraseña de prueba larga';

export interface Session {
  token: string;
  refreshToken: string;
  storeId: string;
  /** Slug de la tienda, para las rutas públicas. */
  slug: string;
  email: string;
}

export interface TestResponse<T> {
  status: number;
  body: T;
}

export interface TestApp {
  call<T = unknown>(
    method: Method,
    url: string,
    session?: { token: string },
    payload?: object,
    headers?: Record<string, string>,
  ): Promise<TestResponse<T>>;
  /** Registra una tienda con su dueña y devuelve la sesión recién emitida. */
  register(label: string): Promise<Session>;
  /** Conexión con el rol dueño, para preparar estados que la API no deja crear. */
  withOwner<T>(work: (client: Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(buildValidationPipe());

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Único por arranque: dos suites que arrancan en el mismo milisegundo no
  // chocan en slug ni en correo.
  const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const storeIds: string[] = [];
  const emails: string[] = [];

  const call = async <T>(
    method: Method,
    url: string,
    session?: { token: string },
    payload?: object,
    headers: Record<string, string> = {},
  ): Promise<TestResponse<T>> => {
    const response = await app.inject({
      method,
      url: `/v1${url}`,
      headers: session ? { ...headers, authorization: `Bearer ${session.token}` } : headers,
      payload,
    });

    // `|| 'null'`: un 204 llega sin cuerpo y `json()` fallaría.
    const body: T = JSON.parse(response.body || 'null');

    return { status: response.statusCode, body };
  };

  const withOwner = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
    const client = new Client({ connectionString: process.env.DIRECT_URL });

    await client.connect();

    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };

  return {
    call,
    withOwner,

    async register(label: string): Promise<Session> {
      const email = `e2e-${label}-${run}@tienda.test`;
      const slug = `e2e-${label}-${run}`;

      const { status, body } = await call<{
        accessToken: string;
        refreshToken: string;
        activeStoreId: string;
      }>('POST', '/auth/register', undefined, {
        email,
        password: TEST_PASSWORD,
        fullName: `Prueba ${label}`,
        storeName: `Tienda ${label}`,
        storeSlug: slug,
        whatsappPhone: '573001234567',
      });

      if (status !== 201) {
        throw new Error(`No se pudo registrar la tienda de prueba "${label}" (HTTP ${status}).`);
      }

      emails.push(email);
      storeIds.push(body.activeStoreId);

      return {
        token: body.accessToken,
        refreshToken: body.refreshToken,
        storeId: body.activeStoreId,
        slug,
        email,
      };
    },

    async close(): Promise<void> {
      await app.close();

      // La cascada desde `stores` arrastra todo el catálogo; la de `users`, las sesiones.
      await withOwner(async (client) => {
        await client.query('delete from stores where id = any($1::uuid[])', [storeIds]);
        await client.query('delete from users where email = any($1::text[])', [emails]);
      });
    },
  };
}
