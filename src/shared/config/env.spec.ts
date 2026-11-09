import { validateEnv } from './env';

/** Lo mínimo para que el entorno valide; cada test le agrega lo suyo. */
const base = {
  DATABASE_URL: 'postgresql://tienda_app@localhost:5432/tienda',
  JWT_SECRET: 'x'.repeat(40),
  COOKIE_SECRET: 'y'.repeat(40),
};

describe('validateEnv: dominios propios', () => {
  it('con el driver log no pide nada de Vercel', () => {
    expect(() => validateEnv({ ...base, DOMAINS_DRIVER: 'log' })).not.toThrow();
  });

  it('con el driver vercel exige el token y el proyecto', () => {
    expect(() => validateEnv({ ...base, DOMAINS_DRIVER: 'vercel' })).toThrow(/VERCEL_API_TOKEN/);
    expect(() => validateEnv({ ...base, DOMAINS_DRIVER: 'vercel' })).toThrow(/VERCEL_PROJECT_ID/);
  });

  it('con el driver vercel y las dos variables, valida', () => {
    const env = validateEnv({
      ...base,
      DOMAINS_DRIVER: 'vercel',
      VERCEL_API_TOKEN: 'tok_de_prueba_largo',
      VERCEL_PROJECT_ID: 'prj_123',
    });

    expect(env.DOMAINS_DRIVER).toBe('vercel');
  });
});
