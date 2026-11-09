import { z } from 'zod';

import {
  DnsRecord,
  DomainInspection,
  DomainProvider,
  DomainProviderError,
} from './domain-provider';
import { splitHost } from './host';
import { hasOwnershipRecord, systemTxtResolver, TxtResolver } from './ownership';

/**
 * Driver de producción: registra cada dominio en el proyecto de Vercel del
 * frontend, que es quien sirve la tienda en ese host.
 *
 * Rutas verificadas contra la documentación de Vercel (REST API, 2026-11):
 * - POST   /v10/projects/{id}/domains                      alta
 * - GET    /v9/projects/{id}/domains/{domain}              estado en el proyecto
 * - POST   /v9/projects/{id}/domains/{domain}/verify       verificación
 * - DELETE /v9/projects/{id}/domains/{domain}              baja
 * - GET    /v6/domains/{domain}/config                     cómo lo ve el DNS
 *
 * Sin SDK: `fetch` directo, y las respuestas se leen con zod. Los tests simulan
 * `fetch`; nada de este archivo llama a Vercel en CI.
 */

const API = 'https://api.vercel.com';

/** Lo que devuelve `GET /v6/domains/{domain}/config`, solo los campos que usamos. */
const configSchema = z.object({
  misconfigured: z.boolean(),
  recommendedCNAME: z.array(z.object({ rank: z.number(), value: z.string() })).default([]),
  recommendedIPv4: z.array(z.object({ rank: z.number(), value: z.array(z.string()) })).default([]),
});

/** Lo que devuelve el dominio dentro del proyecto. `verification` son los desafíos pendientes. */
const projectDomainSchema = z.object({
  verified: z.boolean(),
  verification: z
    .array(z.object({ type: z.string(), domain: z.string(), value: z.string() }))
    .default([]),
});

export interface VercelDomainOptions {
  token: string;
  projectId: string;
  teamId?: string;
  /** Inyectable para los tests. Por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  /** DNS para la prueba de propiedad. Por defecto, el del sistema. */
  txt?: TxtResolver;
}

interface Reply {
  status: number;
  body: unknown;
}

const UNAVAILABLE =
  'No pudimos hablar con el proveedor de dominios. Intenta de nuevo en un momento.';

export class VercelDomainProvider extends DomainProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly txt: TxtResolver;

  constructor(private readonly options: VercelDomainOptions) {
    super();
    this.fetchImpl = options.fetch ?? fetch;
    this.txt = options.txt ?? systemTxtResolver;
  }

  /** Idempotente: si el dominio ya está en el proyecto, no se vuelve a dar de alta. */
  async add(host: string): Promise<void> {
    const existing = await this.request('GET', this.projectDomainPath(host));

    if (existing.status === 200) return;

    const created = await this.request(
      'POST',
      `/v10/projects/${encodeURIComponent(this.options.projectId)}/domains`,
      { name: host },
    );

    if (created.status === 200) return;

    if (created.status === 409) {
      throw new DomainProviderError(
        'taken',
        'Ese dominio ya está en uso en otro proyecto de Vercel. Escríbenos para revisarlo.',
      );
    }

    if (created.status === 400) {
      throw new DomainProviderError(
        'invalid',
        'Vercel no acepta ese dominio. Revísalo y vuelve a intentar.',
      );
    }

    throw new DomainProviderError('unavailable', UNAVAILABLE);
  }

  async inspect(host: string): Promise<DomainInspection> {
    const config = await this.readOk(
      'GET',
      `/v6/domains/${encodeURIComponent(host)}/config`,
      configSchema,
    );
    const project = await this.request('GET', this.projectDomainPath(host));

    // Fuera del proyecto no hay desafíos que mostrar: es "todavía no".
    const domain =
      project.status === 404
        ? { verified: false, verification: [] }
        : parseOk(project, projectDomainSchema, 'GET proyecto/dominio');

    const { label, apex, zone } = splitHost(host);
    const records: DnsRecord[] = [];

    const routing = apex
      ? config.recommendedIPv4.find((item) => item.rank === 1)?.value[0]
      : config.recommendedCNAME.find((item) => item.rank === 1)?.value;

    if (routing) {
      records.push(
        apex
          ? { type: 'A', name: '@', value: routing }
          : { type: 'CNAME', name: label, value: routing },
      );
    }

    // Vercel pide su propio TXT cuando el dominio ya se usó en otra cuenta.
    for (const challenge of domain.verification) {
      if (challenge.type === 'TXT') {
        records.push({
          type: 'TXT',
          name: relativeName(challenge.domain, zone),
          value: challenge.value,
        });
      }
    }

    const error = config.misconfigured
      ? 'El registro de enrutamiento todavía no apunta a Vercel. Pon el registro que te mostramos.'
      : !domain.verified
        ? 'Vercel todavía no verificó el dominio. Pon el registro de verificación que te mostramos.'
        : null;

    return {
      configured: error === null,
      records,
      error,
    };
  }

  /**
   * Dos pruebas: el TXT de propiedad de Globerce (ver ownership.ts) y que Vercel
   * acepte su propio desafío. Si el de Globerce no está, ni se le pide a Vercel.
   */
  async verifyOwnership(host: string, token: string): Promise<boolean> {
    if (!(await hasOwnershipRecord(this.txt, host, token))) return false;

    const verified = await this.request('POST', `${this.projectDomainPath(host)}/verify`);

    if (verified.status === 200) return true;

    // 400: el desafío de Vercel todavía no está en el DNS. No es un fallo del proveedor.
    if (verified.status === 400) return false;

    throw new DomainProviderError('unavailable', UNAVAILABLE);
  }

  async remove(host: string): Promise<void> {
    const removed = await this.request('DELETE', this.projectDomainPath(host));

    // 404: ya no estaba en el proyecto. Quitarlo dos veces no es un error.
    if (removed.status === 200 || removed.status === 404) return;

    throw new DomainProviderError('unavailable', UNAVAILABLE);
  }

  private projectPath(suffix: string): string {
    return `/v9/projects/${encodeURIComponent(this.options.projectId)}${suffix}`;
  }

  private projectDomainPath(host: string): string {
    return this.projectPath(`/domains/${encodeURIComponent(host)}`);
  }

  private async readOk<T>(
    method: 'GET',
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    return parseOk(await this.request(method, path), schema, path);
  }

  /** Una llamada a la API. Nunca lanza por el estado HTTP: eso lo decide quien llama. */
  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Reply> {
    const url = new URL(`${API}${path}`);

    if (this.options.teamId) url.searchParams.set('teamId', this.options.teamId);

    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new DomainProviderError('unavailable', UNAVAILABLE);
    }

    const parsed: unknown = await response.json().catch(() => undefined);

    return { status: response.status, body: parsed };
  }
}

/** Una respuesta que tiene que ser 200 y tener la forma esperada. Si no, es el proveedor fallando. */
function parseOk<T>(reply: Reply, schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string): T {
  if (reply.status !== 200) {
    throw new DomainProviderError('unavailable', UNAVAILABLE);
  }

  const parsed = schema.safeParse(reply.body);

  if (!parsed.success) {
    throw new DomainProviderError('unavailable', `${UNAVAILABLE} (${path})`);
  }

  return parsed.data;
}

/** El nombre de un registro relativo a la zona: `_vercel.www.tienda.com` → `_vercel.www`, la raíz → `@`. */
function relativeName(domain: string, zone: string): string {
  if (domain === zone) return '@';

  const suffix = `.${zone}`;

  return domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : domain;
}
