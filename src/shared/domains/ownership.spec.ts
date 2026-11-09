import { hasOwnershipRecord, ownershipName, ownershipValue, TxtResolver } from './ownership';

/** Un DNS de mentira: un mapa de nombre a registros TXT. Sin nombre, NXDOMAIN. */
function fakeDns(records: Record<string, string[][]>): TxtResolver {
  return {
    resolveTxt: (name) => {
      const found = records[name];

      if (!found) return Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));

      return Promise.resolve(found);
    },
  };
}

describe('hasOwnershipRecord', () => {
  const host = 'www.tienda.com';
  const token = 'abc123';

  it('acepta el token en el TXT del host', async () => {
    const dns = fakeDns({ [ownershipName(host)]: [[ownershipValue(token)]] });

    await expect(hasOwnershipRecord(dns, host, token)).resolves.toBe(true);
  });

  it('une los trozos de un TXT largo antes de comparar', async () => {
    const value = ownershipValue(token);
    const dns = fakeDns({ [ownershipName(host)]: [[value.slice(0, 10), value.slice(10)]] });

    await expect(hasOwnershipRecord(dns, host, token)).resolves.toBe(true);
  });

  it('no acepta un token ajeno ni un TXT sin el prefijo', async () => {
    const dns = fakeDns({
      [ownershipName(host)]: [[ownershipValue('otro-token')], ['basura']],
    });

    await expect(hasOwnershipRecord(dns, host, token)).resolves.toBe(false);
  });

  it('sin registro cuenta como no, no como error', async () => {
    await expect(hasOwnershipRecord(fakeDns({}), host, token)).resolves.toBe(false);
  });

  it('el nombre del TXT es _globerce delante del host completo', () => {
    expect(ownershipName('tienda.com')).toBe('_globerce.tienda.com');
    expect(ownershipName('www.tienda.com')).toBe('_globerce.www.tienda.com');
  });
});

/** Un DNS que falla con un código concreto de node:dns (ETIMEOUT, ESERVFAIL…). */
function failingDns(code: string): TxtResolver {
  return {
    resolveTxt: () => Promise.reject(Object.assign(new Error(code), { code })),
  };
}

describe('hasOwnershipRecord ante errores de DNS', () => {
  const host = 'www.tienda.com';

  it.each(['ENOTFOUND', 'ENODATA'])('%s es "sin registro": devuelve false', async (code) => {
    await expect(hasOwnershipRecord(failingDns(code), host, 'tok')).resolves.toBe(false);
  });

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])(
    '%s no es "sin registro": se lanza como proveedor no disponible',
    async (code) => {
      await expect(hasOwnershipRecord(failingDns(code), host, 'tok')).rejects.toMatchObject({
        kind: 'unavailable',
      });
    },
  );
});
