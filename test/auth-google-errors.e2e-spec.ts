import { FakeGoogle, newCodeVerifier } from './utils/fake-google';
import { startTestApp, TestApp } from './utils/test-app';

/**
 * Lo que responde `/auth/google` cuando algo no cuadra. Aparte de los flujos
 * porque el endpoint está limitado a 10 por minuto: cada suite tiene su propio
 * contador.
 */

jest.setTimeout(60_000);

const REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

interface ErrorBody {
  message: string;
  error: string;
}

describe('Entrar con Google: rechazos (e2e)', () => {
  const google = new FakeGoogle();
  let api: TestApp;

  const exchange = (body: object) =>
    api.call<ErrorBody>('POST', '/auth/google', undefined, { redirectUri: REDIRECT_URI, ...body });

  beforeAll(async () => {
    api = await startTestApp({ googleFetch: google.fetch });
  });

  afterAll(async () => {
    await api?.close();
  });

  it('un correo que Google no confirma es 403 google_email_unverified', async () => {
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(
      { sub: 'sin-verificar', email: api.email('google-sin-verificar'), emailVerified: false },
      codeVerifier,
      REDIRECT_URI,
    );

    const { status, body } = await exchange({ code, codeVerifier });

    expect(status).toBe(403);
    expect(body.error).toBe('google_email_unverified');
    expect(body.message).toContain('Google');
  });

  it('un código ya canjeado es 400 google_exchange_failed', async () => {
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(
      { sub: 'reuso', email: api.email('google-reuso') },
      codeVerifier,
      REDIRECT_URI,
    );

    expect((await exchange({ code, codeVerifier })).status).toBe(200);

    const { status, body } = await exchange({ code, codeVerifier });

    expect(status).toBe(400);
    expect(body.error).toBe('google_exchange_failed');
  });

  it('un verificador de PKCE distinto es 400 google_exchange_failed', async () => {
    const code = google.authorize(
      { sub: 'pkce', email: api.email('google-pkce') },
      newCodeVerifier(),
      REDIRECT_URI,
    );

    const { status, body } = await exchange({ code, codeVerifier: newCodeVerifier() });

    expect(status).toBe(400);
    expect(body.error).toBe('google_exchange_failed');
  });

  it('una redirectUri que no está en GOOGLE_REDIRECT_URIS es 400', async () => {
    const redirectUri = 'https://atacante.test/auth/google/callback';
    const codeVerifier = newCodeVerifier();
    const code = google.authorize(
      { sub: 'redirect', email: api.email('google-redirect') },
      codeVerifier,
      redirectUri,
    );

    const { status, body } = await exchange({ code, codeVerifier, redirectUri });

    expect(status).toBe(400);
    expect(body.error).toBe('google_redirect_uri_not_allowed');
  });

  it('un verificador con formato inválido no pasa la validación', async () => {
    const { status } = await exchange({ code: 'x', codeVerifier: 'corto' });

    expect(status).toBe(400);
  });

  it('un signupToken inventado es 401 signup_token_invalid', async () => {
    const { status, body } = await api.call<ErrorBody>('POST', '/auth/google/register', undefined, {
      signupToken: 'esto.no.sirve',
      storeName: 'Tienda',
      storeSlug: 'e2e-google-inventado',
      whatsappPhone: '573001234567',
    });

    expect(status).toBe(401);
    expect(body.error).toBe('signup_token_invalid');
  });
});
