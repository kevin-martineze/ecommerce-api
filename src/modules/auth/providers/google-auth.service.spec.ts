import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FAKE_GOOGLE_CLIENT_ID,
  FAKE_GOOGLE_CLIENT_SECRET,
  FAKE_GOOGLE_REDIRECT_URI,
  FakeGoogle,
  newCodeVerifier,
} from '../../../../test/utils/fake-google';

import { GoogleAuthService } from './google-auth.service';

const configured = {
  GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: FAKE_GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URIS: [FAKE_GOOGLE_REDIRECT_URI],
};

const account = { sub: '1098765432101234567890', email: 'Duena@Gmail.com', name: ' María ' };

function serviceWith(google: FakeGoogle, env: Record<string, unknown> = configured) {
  return new GoogleAuthService(new ConfigService(env), google.fetch);
}

/** El código estable y el estado de la excepción, que es lo que ve el frontend. */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; error: unknown }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof HttpException) {
      const body = error.getResponse();

      return {
        status: error.getStatus(),
        error: typeof body === 'object' && body !== null && 'error' in body ? body.error : null,
      };
    }

    throw error;
  }

  throw new Error('Se esperaba un rechazo.');
}

describe('GoogleAuthService', () => {
  let google: FakeGoogle;
  let verifier: string;

  beforeEach(() => {
    google = new FakeGoogle();
    verifier = newCodeVerifier();
  });

  it('canjea el código, verifica el id_token y normaliza el correo', async () => {
    const code = google.authorize(account, verifier);

    await expect(
      serviceWith(google).profileFromCode(code, verifier, FAKE_GOOGLE_REDIRECT_URI),
    ).resolves.toEqual({
      subject: account.sub,
      email: 'duena@gmail.com',
      fullName: 'María',
    });
  });

  it('sin nombre en Google, fullName es null', async () => {
    const code = google.authorize({ sub: '1', email: 'sin-nombre@gmail.com' }, verifier);

    const profile = await serviceWith(google).profileFromCode(
      code,
      verifier,
      FAKE_GOOGLE_REDIRECT_URI,
    );

    expect(profile.fullName).toBeNull();
  });

  it('sin id ni secreto responde google_not_configured', async () => {
    const code = google.authorize(account, verifier);

    await expect(
      rejection(
        serviceWith(google, { GOOGLE_REDIRECT_URIS: [FAKE_GOOGLE_REDIRECT_URI] }).profileFromCode(
          code,
          verifier,
          FAKE_GOOGLE_REDIRECT_URI,
        ),
      ),
    ).resolves.toEqual({ status: 503, error: 'google_not_configured' });
  });

  it('una redirectUri fuera de la lista no llega a Google', async () => {
    const other = 'https://atacante.test/auth/google/callback';
    const code = google.authorize(account, verifier, other);

    await expect(
      rejection(serviceWith(google).profileFromCode(code, verifier, other)),
    ).resolves.toEqual({ status: 400, error: 'google_redirect_uri_not_allowed' });
  });

  it('un código ya usado o con otro verificador es google_exchange_failed', async () => {
    const service = serviceWith(google);
    const code = google.authorize(account, verifier);

    await expect(
      rejection(service.profileFromCode(code, newCodeVerifier(), FAKE_GOOGLE_REDIRECT_URI)),
    ).resolves.toEqual({ status: 400, error: 'google_exchange_failed' });

    // Google lo invalidó en el primer intento, aunque fallara.
    await expect(
      rejection(service.profileFromCode(code, verifier, FAKE_GOOGLE_REDIRECT_URI)),
    ).resolves.toEqual({ status: 400, error: 'google_exchange_failed' });
  });

  it('un correo que Google no confirma es google_email_unverified', async () => {
    const code = google.authorize({ ...account, emailVerified: false }, verifier);

    await expect(
      rejection(serviceWith(google).profileFromCode(code, verifier, FAKE_GOOGLE_REDIRECT_URI)),
    ).resolves.toEqual({ status: 403, error: 'google_email_unverified' });
  });

  it.each([
    ['emitido para otra app', { aud: 'otra-app.apps.googleusercontent.com' }],
    ['de otro emisor', { iss: 'https://accounts.atacante.test' }],
    [
      'ya vencido',
      {
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
    ],
  ])('un id_token %s no pasa', async (_case, overrides) => {
    const code = google.authorize(account, verifier, FAKE_GOOGLE_REDIRECT_URI, overrides);

    await expect(
      rejection(serviceWith(google).profileFromCode(code, verifier, FAKE_GOOGLE_REDIRECT_URI)),
    ).resolves.toEqual({ status: 400, error: 'google_exchange_failed' });
  });

  it('un id_token firmado con otra llave no pasa', async () => {
    const impostor = new FakeGoogle();
    const code = impostor.authorize(account, verifier);
    // Canjea contra el impostor, pero los certificados son los del Google "de verdad".
    const mixed = new GoogleAuthService(new ConfigService(configured), (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      return url.includes('/certs') ? google.fetch(input, init) : impostor.fetch(input, init);
    });

    await expect(
      rejection(mixed.profileFromCode(code, verifier, FAKE_GOOGLE_REDIRECT_URI)),
    ).resolves.toEqual({ status: 400, error: 'google_exchange_failed' });
  });
});
