import { redactUrl } from './redact-url';

describe('redactUrl', () => {
  it('oculta el ticket del stream y deja el resto', () => {
    expect(redactUrl('/v1/notifications/stream?ticket=eyJabc.def.ghi&after=123')).toBe(
      '/v1/notifications/stream?ticket=[oculto]&after=123',
    );
  });

  it('lo encuentra aunque no sea el primer parámetro', () => {
    expect(redactUrl('/v1/notifications/stream?after=1&ticket=secreto')).toBe(
      '/v1/notifications/stream?after=1&ticket=[oculto]',
    );
  });

  it('no toca una URL sin secretos', () => {
    expect(redactUrl('/v1/public/luna/products?page=2')).toBe('/v1/public/luna/products?page=2');
  });

  it('no confunde un parámetro que solo termina igual', () => {
    expect(redactUrl('/x?subticket=1')).toBe('/x?subticket=1');
  });
});
