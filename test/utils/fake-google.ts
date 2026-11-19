import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { GoogleFetch } from '@modules/auth/providers/google-auth.service';

/**
 * Un Google de mentira para las pruebas: el endpoint de tokens y el de
 * certificados, nada más.
 *
 * Firma sus `id_token` con una llave RSA propia y publica la pública en su
 * endpoint de certificados, así `google-auth-library` verifica firma,
 * audiencia, emisor y vencimiento igual que contra el de verdad. Lo único
 * simulado es la red.
 */

export interface FakeGoogleAccount {
  sub: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}

/** Para fabricar un `id_token` que Google nunca daría y ver que se rechaza. */
export type IdTokenOverrides = Partial<Record<'aud' | 'iss' | 'exp' | 'iat', string | number>>;

interface PendingCode {
  account: FakeGoogleAccount;
  codeVerifier: string;
  redirectUri: string;
  overrides: IdTokenOverrides;
}

export const FAKE_GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
export const FAKE_GOOGLE_CLIENT_SECRET = 'fake-client-secret-de-pruebas';
export const FAKE_GOOGLE_REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

/** Un `code_verifier` válido de PKCE (43 a 128 caracteres sin reservar). */
export function newCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

export class FakeGoogle {
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly kid = randomBytes(8).toString('hex');
  private readonly codes = new Map<string, PendingCode>();

  constructor(
    private readonly clientId = FAKE_GOOGLE_CLIENT_ID,
    private readonly clientSecret = FAKE_GOOGLE_CLIENT_SECRET,
  ) {}

  /** Lo que Google dejaría en el callback después de que la persona elige esa cuenta. */
  authorize(
    account: FakeGoogleAccount,
    codeVerifier: string,
    redirectUri = FAKE_GOOGLE_REDIRECT_URI,
    overrides: IdTokenOverrides = {},
  ): string {
    const code = `4/fake-${randomBytes(12).toString('hex')}`;

    this.codes.set(code, { account, codeVerifier, redirectUri, overrides });

    return code;
  }

  /** Reemplaza al `fetch` con el que la API habla con Google. */
  readonly fetch: GoogleFetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/certs')) {
      const pem = this.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

      return Promise.resolve(json(200, { [this.kid]: pem }));
    }

    if (url.endsWith('/token') && init?.method === 'POST') {
      return Promise.resolve(this.token(new URLSearchParams(bodyText(init.body))));
    }

    return Promise.resolve(json(404, { error: 'not_found' }));
  };

  /** Como el de Google: un código sirve una sola vez y con el mismo verificador y regreso. */
  private token(form: URLSearchParams): Response {
    const code = form.get('code') ?? '';
    const pending = this.codes.get(code);

    this.codes.delete(code);

    const valid =
      pending !== undefined &&
      form.get('grant_type') === 'authorization_code' &&
      form.get('client_id') === this.clientId &&
      form.get('client_secret') === this.clientSecret &&
      form.get('code_verifier') === pending.codeVerifier &&
      form.get('redirect_uri') === pending.redirectUri;

    if (!valid) {
      return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
    }

    return json(200, {
      access_token: `ya29.fake-${randomBytes(8).toString('hex')}`,
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid email profile',
      id_token: this.idToken(pending.account, pending.overrides),
    });
  }

  private idToken(account: FakeGoogleAccount, overrides: IdTokenOverrides): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: this.kid, typ: 'JWT' };
    const payload = {
      iss: 'https://accounts.google.com',
      azp: this.clientId,
      aud: this.clientId,
      sub: account.sub,
      email: account.email,
      email_verified: account.emailVerified ?? true,
      ...(account.name ? { name: account.name } : {}),
      iat: now,
      exp: now + 3600,
      ...overrides,
    };

    const signed = `${base64url(header)}.${base64url(payload)}`;
    const signature = sign('RSA-SHA256', Buffer.from(signed), this.keys.privateKey);

    return `${signed}.${signature.toString('base64url')}`;
  }
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') {
    return body;
  }

  return body instanceof URLSearchParams ? body.toString() : '';
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
