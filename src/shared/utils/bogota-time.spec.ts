import { startOfMonthInBogota } from './bogota-time';

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
