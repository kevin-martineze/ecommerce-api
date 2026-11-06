import { PublicAddressSource } from '@shared/tenancy/public-url';

import { safeReturnUrl } from './return-url';

const FRONT = 'globerce.store';

const tienda: PublicAddressSource = {
  slug: 'boutique',
  status: 'ACTIVE',
  customDomain: 'www.sutienda.com',
  customDomainStatus: 'ACTIVE',
  planAllowsCustomDomain: true,
};

const policy = (store: PublicAddressSource = tienda) => ({ frontendHost: FRONT, store });

describe('safeReturnUrl', () => {
  it('acepta el host de la plataforma y sus subdominios', () => {
    expect(safeReturnUrl('https://globerce.store/pedido/1', policy())).toBe(
      'https://globerce.store/pedido/1',
    );
    expect(safeReturnUrl('https://boutique.globerce.store/pedido/1', policy())).toBe(
      'https://boutique.globerce.store/pedido/1',
    );
  });

  it('acepta el dominio propio activo de ESA tienda, por https', () => {
    expect(safeReturnUrl('https://www.sutienda.com/pedido/1?t=x', policy())).toBe(
      'https://www.sutienda.com/pedido/1?t=x',
    );
  });

  it('rechaza el dominio propio por http', () => {
    expect(safeReturnUrl('http://www.sutienda.com/pedido/1', policy())).toBeNull();
  });

  it('rechaza el dominio de otra tienda', () => {
    expect(safeReturnUrl('https://www.otra.com/pedido/1', policy())).toBeNull();
  });

  it('rechaza el dominio propio de la tienda mientras está pendiente', () => {
    expect(
      safeReturnUrl('https://www.sutienda.com/pedido/1', {
        frontendHost: FRONT,
        store: { ...tienda, customDomainStatus: 'PENDING' },
      }),
    ).toBeNull();
  });

  it('rechaza el dominio propio si el plan ya no lo incluye o la tienda está suspendida', () => {
    expect(
      safeReturnUrl(
        'https://www.sutienda.com/x',
        policy({ ...tienda, planAllowsCustomDomain: false }),
      ),
    ).toBeNull();
    expect(
      safeReturnUrl('https://www.sutienda.com/x', policy({ ...tienda, status: 'SUSPENDED' })),
    ).toBeNull();
  });

  it('rechaza una URL mal formada y un host ajeno que solo se parece', () => {
    expect(safeReturnUrl('no es una url', policy())).toBeNull();
    expect(safeReturnUrl('https://globerce.store.evil.com/x', policy())).toBeNull();
  });
});
