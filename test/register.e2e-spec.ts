import { Session, startTestApp, TEST_PASSWORD, TestApp } from './utils/test-app';

/**
 * Lo que responde el registro cuando algo ya está tomado.
 *
 * Va en su propio archivo y no junto al resto de cuenta porque `/auth/register`
 * está limitado a 5 intentos por minuto y por IP: cada suite arranca su propia
 * API, con su propio contador, así que separarlas es lo que deja probar los
 * choques sin gastarle el cupo a las demás.
 */

jest.setTimeout(60_000);

interface ErrorBody {
  message: string;
  error: string;
}

describe('Registro (e2e)', () => {
  let api: TestApp;
  let tienda: Session;

  const register = (body: object) =>
    api.call<ErrorBody>('POST', '/auth/register', undefined, {
      password: TEST_PASSWORD,
      fullName: 'Prueba registro',
      storeName: 'Prueba registro',
      whatsappPhone: '573001234567',
      ...body,
    });

  beforeAll(async () => {
    api = await startTestApp();
    tienda = await api.register('registro');
  });

  afterAll(async () => {
    await api?.close();
  });

  it('un correo ya registrado dice que es el correo', async () => {
    const { status, body } = await register({
      email: tienda.email,
      storeSlug: `e2e-registro-libre-${Date.now().toString(36)}`,
    });

    expect(status).toBe(409);
    // El código es lo que le dice al frontend bajo qué campo poner el mensaje.
    expect(body.error).toBe('email_taken');
    expect(body.message).toContain('correo');
  });

  it('una dirección reservada no se puede registrar', async () => {
    // `www.globerce.store` es la plataforma: una tienda ahí existiría en la
    // base y no habría dirección donde abrirla.
    const { status } = await register({
      email: api.email('registro-reservado'),
      storeSlug: 'www',
    });

    expect(status).toBe(400);
  });

  it('una dirección ya tomada dice que es la dirección', async () => {
    const { status, body } = await register({
      email: api.email('registro-libre'),
      storeSlug: tienda.slug,
    });

    expect(status).toBe(409);
    expect(body.error).toBe('slug_taken');
    expect(body.message).toContain('dirección');
  });
});
