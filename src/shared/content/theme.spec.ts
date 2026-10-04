import { EMPTY_THEME, isEmptyTheme, readTheme } from './theme';

describe('readTheme', () => {
  it('sin columna, la plantilla tal cual', () => {
    expect(readTheme(null)).toEqual(EMPTY_THEME);
    expect(readTheme('azul')).toEqual(EMPTY_THEME);
    expect(readTheme(['serif'])).toEqual(EMPTY_THEME);
  });

  it('lee los ajustes que reconoce y normaliza el color a mayúsculas', () => {
    expect(
      readTheme({ accent: '#1d4ed8', fonts: 'serif', corners: 'round', hero: 'split' }),
    ).toEqual({ accent: '#1D4ED8', fonts: 'serif', corners: 'round', hero: 'split' });
  });

  it('un ajuste retirado o mal formado vuelve a ser el de la plantilla', () => {
    expect(
      readTheme({ accent: 'red', fonts: 'comic', corners: 'soft', hero: 'carrusel', extra: 1 }),
    ).toEqual({ accent: null, fonts: null, corners: 'soft', hero: null });
  });
});

describe('isEmptyTheme', () => {
  it('solo está vacío si no queda ningún ajuste', () => {
    expect(isEmptyTheme(EMPTY_THEME)).toBe(true);
    expect(isEmptyTheme({ ...EMPTY_THEME, corners: 'square' })).toBe(false);
  });
});
