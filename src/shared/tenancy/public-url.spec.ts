import { publicUrl, PublicAddressSource } from './public-url';

const FRONT = 'https://globerce.store';

const base: PublicAddressSource = {
  slug: 'boutique',
  status: 'ACTIVE',
  customDomain: 'www.sutienda.com',
  customDomainStatus: 'ACTIVE',
  planAllowsCustomDomain: true,
};

describe('publicUrl', () => {
  it('usa el dominio propio cuando está activo, el plan lo incluye y la tienda no está suspendida', () => {
    expect(publicUrl(base, FRONT)).toBe('https://www.sutienda.com');
  });

  it('cae al subdominio mientras el dominio no esté activo', () => {
    for (const customDomainStatus of ['PENDING', 'FAILED'] as const) {
      expect(publicUrl({ ...base, customDomainStatus }, FRONT)).toBe(
        'https://boutique.globerce.store',
      );
    }
  });

  it('cae al subdominio si el plan ya no incluye dominio propio', () => {
    expect(publicUrl({ ...base, planAllowsCustomDomain: false }, FRONT)).toBe(
      'https://boutique.globerce.store',
    );
  });

  it('cae al subdominio si la tienda está suspendida', () => {
    expect(publicUrl({ ...base, status: 'SUSPENDED' }, FRONT)).toBe(
      'https://boutique.globerce.store',
    );
  });

  it('sin dominio propio, da el subdominio', () => {
    expect(publicUrl({ ...base, customDomain: null, customDomainStatus: null }, FRONT)).toBe(
      'https://boutique.globerce.store',
    );
  });

  it('en desarrollo arma el subdominio con el puerto de FRONTEND_URL', () => {
    expect(
      publicUrl(
        { ...base, customDomain: null, customDomainStatus: null },
        'http://localhost:5173/',
      ),
    ).toBe('http://boutique.localhost:5173');
  });
});
