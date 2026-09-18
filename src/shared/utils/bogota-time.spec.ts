import { bogotaMonthKey, bogotaMonthRange, startOfMonthInBogota } from './bogota-time';

describe('startOfMonthInBogota', () => {
  it('el día 1 a medianoche en Bogotá son las 05:00 UTC', () => {
    expect(startOfMonthInBogota(new Date('2026-09-14T15:00:00Z')).toISOString()).toBe(
      '2026-09-01T05:00:00.000Z',
    );
  });

  it('las últimas horas del mes en Bogotá siguen siendo de ese mes aunque en UTC ya sea el siguiente', () => {
    // 30 de septiembre, 9 p. m. en Bogotá = 1 de octubre, 02:00 UTC.
    expect(startOfMonthInBogota(new Date('2026-10-01T02:00:00Z')).toISOString()).toBe(
      '2026-09-01T05:00:00.000Z',
    );
  });

  it('cruza el año', () => {
    expect(startOfMonthInBogota(new Date('2027-01-01T03:00:00Z')).toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });
});

describe('bogotaMonthKey / bogotaMonthRange', () => {
  it('las últimas horas del mes en UTC siguen siendo del mes en Bogotá', () => {
    // 1 de octubre 03:00 UTC = 30 de septiembre 22:00 en Bogotá.
    expect(bogotaMonthKey(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09');
    expect(bogotaMonthKey(new Date('2026-10-01T05:00:00Z'))).toBe('2026-10');
  });

  it('el rango del mes arranca a las 05:00 UTC del día 1 y termina al empezar el siguiente', () => {
    const { start, end } = bogotaMonthRange('2026-12');

    expect(start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('rechaza un mes mal escrito', () => {
    expect(() => bogotaMonthRange('2026-9')).toThrow();
  });
});
