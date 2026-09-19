import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyMultipart from '@fastify/multipart';
import { Client } from 'pg';
import { Assistant } from '@shared/ai/assistant';
import { buildValidationPipe } from '@shared/config/validation-pipe';
import { FRONT_SECRET_HEADER } from '@shared/guards/front-secret.guard';
import { LogMailer } from '@shared/mail/log-mailer';
import { Mailer } from '@shared/mail/mailer';
import { MULTIPART_OPTIONS } from '@shared/media/upload';

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

export interface TestFile {
  /** Nombre del campo del formulario. */
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface TestApp {
  call<T = unknown>(
    method: Method,
    url: string,
    session?: { token: string },
    payload?: object,
    headers?: Record<string, string>,
  ): Promise<TestResponse<T>>;
  /** Una petición SIN el secreto del frontend, como la haría alguien de afuera. */
  withoutSecret<T = unknown>(method: Method, url: string): Promise<TestResponse<T>>;
  /** Envía un archivo como multipart/form-data, con campos de texto opcionales. */
  upload<T = unknown>(
    method: Method,
    url: string,
    session: { token: string },
    file: TestFile,
    fields?: Record<string, string>,
  ): Promise<TestResponse<T>>;
  /** Registra una tienda con su dueña y devuelve la sesión recién emitida. */
  register(label: string, planCode?: string): Promise<Session>;
  /** Directorio donde el driver local deja las fotos durante esta prueba. */
  mediaDir: string;
  /** Texto del último correo enviado a esa dirección, o null. */
  lastMailTo(email: string): string | null;
  /** Un correo único de esta corrida, que `close` borra si llega a tener cuenta. */
  email(label: string): string;
  /** Una tienda creada por fuera de `register`, para que `close` también la borre. */
  forgetStore(storeId: string): void;
  /** Conexión con el rol dueño, para preparar estados que la API no deja crear. */
  withOwner<T>(work: (client: Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /**
   * Sustituye el asistente por un doble.
   *
   * El de verdad llama a un modelo: cuesta plata, tarda y no responde igual
   * dos veces. Lo que estas pruebas tienen que comprobar es lo de alrededor
   * —el plan, el tope del mes, el aislamiento—, no que el modelo redacte
   * bonito.
   */
  assistant?: Assistant;
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  // Lo fija `setup-env.ts` antes de importar `AppModule`; ver allí por qué.
  const mediaDir = process.env.MEDIA_DIR;

  if (!mediaDir) {
    throw new Error('MEDIA_DIR no está definida: falta test/setup-env.ts en jest-e2e.json.');
  }

  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (options.assistant) {
    builder.overrideProvider(Assistant).useValue(options.assistant);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(buildValidationPipe());
  await app.register(fastifyMultipart, MULTIPART_OPTIONS);

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
      headers: {
        // El frontend real lo manda en cada petición; acá se agrega salvo que
        // la prueba traiga el suyo, que es como se comprueba la puerta.
        [FRONT_SECRET_HEADER]: process.env.API_SHARED_SECRET ?? '',
        ...headers,
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      },
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

  const upload = async <T>(
    method: Method,
    url: string,
    session: { token: string },
    file: TestFile,
    fields: Record<string, string> = {},
  ): Promise<TestResponse<T>> => {
    const boundary = `----prueba${randomBytes(8).toString('hex')}`;
    const parts = Object.entries(fields).map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );

    const payload = Buffer.concat([
      Buffer.from(parts.join(''), 'utf8'),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.data,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const response = await app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        [FRONT_SECRET_HEADER]: process.env.API_SHARED_SECRET ?? '',
        authorization: `Bearer ${session.token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    const body: T = JSON.parse(response.body || 'null');

    return { status: response.statusCode, body };
  };

  const withoutSecret = async <T>(method: Method, url: string): Promise<TestResponse<T>> => {
    const response = await app.inject({ method, url: `/v1${url}` });

    return { status: response.statusCode, body: JSON.parse(response.body || 'null') as T };
  };

  const mailer = app.get(Mailer);

  return {
    call,
    withoutSecret,
    upload,
    withOwner,
    mediaDir,

    forgetStore(storeId: string): void {
      storeIds.push(storeId);
    },

    email(label: string): string {
      const email = `e2e-${label}-${run}@tienda.test`;

      emails.push(email);

      return email;
    },

    lastMailTo(email: string): string | null {
      return mailer instanceof LogMailer ? (mailer.lastTo(email)?.text ?? null) : null;
    },

    async register(label: string, planCode?: string): Promise<Session> {
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
        ...(planCode ? { planCode } : {}),
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
      await rm(mediaDir, { recursive: true, force: true });

      // La cascada desde `stores` arrastra todo el catálogo; la de `users`, las sesiones.
      await withOwner(async (client) => {
        await client.query('delete from stores where id = any($1::uuid[])', [storeIds]);
        await client.query('delete from users where email = any($1::text[])', [emails]);
      });
    },
  };
}
