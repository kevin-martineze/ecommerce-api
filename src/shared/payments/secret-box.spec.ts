import { maskKey, open, seal } from './secret-box';

const SECRETO = 'un secreto de plataforma suficientemente largo';

describe('secret-box', () => {
  it('lo que se cifra se recupera igual', () => {
    const llave = 'prv_prod_una_llave_privada_de_la_tienda';

    expect(open(seal(llave, SECRETO), SECRETO)).toBe(llave);
  });

  it('dos veces el mismo valor no se cifra igual', () => {
    // Si el cifrado fuera igual, un volcado diría qué tiendas comparten llave.
    expect(seal('igual', SECRETO)).not.toBe(seal('igual', SECRETO));
  });

  it('con otro secreto no se abre', () => {
    expect(open(seal('llave', SECRETO), 'otro secreto igual de largo pero otro')).toBeNull();
  });

  it('un valor manipulado no se abre a medias: no se abre', () => {
    const sellado = seal('llave', SECRETO);
    const roto = `${sellado.slice(0, -2)}xy`;

    expect(open(roto, SECRETO)).toBeNull();
    expect(open('cualquier cosa', SECRETO)).toBeNull();
    expect(open('', SECRETO)).toBeNull();
  });

  it('a la dueña se le enseña solo el final de su llave', () => {
    expect(maskKey('pub_prod_abcdefgh1234')).toBe('••••1234');
    expect(maskKey('corta')).toBe('••••');
  });
});
