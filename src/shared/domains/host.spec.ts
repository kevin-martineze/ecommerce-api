import { checkCustomHost, normalizeHost, splitHost } from './host';

const FRONT = 'globerce.store';

describe('normalizeHost', () => {
  it('quita espacios, mayúsculas, puerto y punto final, en ese orden', () => {
    expect(normalizeHost('  WWW.Tienda.com:443 ')).toBe('www.tienda.com');
    expect(normalizeHost('x.com.:443')).toBe('x.com');
    expect(normalizeHost('WWW.Tienda.com:443.')).toBe('www.tienda.com');
  });
});

describe('splitHost', () => {
  it('separa la zona registrable de la etiqueta, incluso con sufijo compuesto', () => {
    expect(splitHost('www.tienda.com.co')).toEqual({
      zone: 'tienda.com.co',
      label: 'www',
      apex: false,
    });
    expect(splitHost('tienda.com.co')).toEqual({ zone: 'tienda.com.co', label: '', apex: true });
  });
});

describe('checkCustomHost', () => {
  it('acepta un dominio válido y lo devuelve normalizado', () => {
    expect(checkCustomHost('WWW.SuTienda.com', FRONT)).toEqual({
      ok: true,
      host: 'www.sutienda.com',
      zone: 'sutienda.com',
      label: 'www',
      apex: false,
    });
  });

  it.each([
    ['', /Escribe el dominio/],
    ['tienda', /extensión/],
    ['192.168.0.1', /dirección IP/],
    ['localhost', /no se puede usar/],
    ['app.localhost', /no se puede usar/],
    ['proyecto.vercel.app', /no se puede usar/],
    ['globerce.store', /es de Globerce/],
    ['tienda.globerce.store', /es de Globerce/],
    ['mi_tienda.com', /caracteres que no se aceptan/],
    ['tienda.ñandú.com', /caracteres que no se aceptan/],
    ['-malo.com', /caracteres que no se aceptan/],
    ['com.co', /no es válido/],
    [`${'a'.repeat(64)}.com`, /caracteres que no se aceptan/],
    [`${'a'.repeat(250)}.com`, /demasiado largo/],
  ])('rechaza %s', (raw, message) => {
    const result = checkCustomHost(raw, FRONT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it('acepta punycode', () => {
    expect(checkCustomHost('xn--tienda-9za.com', FRONT).ok).toBe(true);
  });
});
