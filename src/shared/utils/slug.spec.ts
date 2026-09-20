import { buildSku, firstAvailable, skuBase, slugify } from './slug';

describe('slugify', () => {
  it('pasa a minúsculas y une las palabras con guion', () => {
    expect(slugify('Blusa Vera')).toBe('blusa-vera');
  });

  it('quita tildes y eñes sin perder la letra', () => {
    expect(slugify('Camisón Añil')).toBe('camison-anil');
  });

  it('colapsa símbolos y recorta guiones en los bordes', () => {
    expect(slugify('  ¡Top  #1 Nuevo! ')).toBe('top-1-nuevo');
  });

  it('devuelve vacío cuando no queda nada utilizable', () => {
    expect(slugify('¡¡!!')).toBe('');
  });
});

describe('buildSku', () => {
  it('usa los 10 primeros caracteres del producto sin guiones', () => {
    expect(skuBase('vestido-negro-largo')).toBe('VESTIDONEG');
    expect(buildSku('vestido-negro-largo', 'negro', 'm')).toBe('VESTIDONEG-NEGRO-M');
  });
});

describe('firstAvailable', () => {
  it('devuelve la base si está libre', () => {
    expect(firstAvailable('negro', new Set(['blanco']))).toBe('negro');
  });

  it('numera desde 2 saltando los que ya existen', () => {
    expect(firstAvailable('negro', new Set(['negro', 'negro-2', 'negro-3']))).toBe('negro-4');
  });

  it('no confunde un valor que solo empieza igual', () => {
    expect(firstAvailable('negro', new Set(['negro-mate']))).toBe('negro');
  });
});
