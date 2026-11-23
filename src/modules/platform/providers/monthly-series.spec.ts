import { buildMonthlySeries, recentMonths } from './monthly-series';

describe('recentMonths', () => {
  it('devuelve seis meses de Bogotá, del más viejo al actual', () => {
    expect(recentMonths(new Date('2026-11-15T15:00:00Z'))).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('cruza el cambio de año', () => {
    expect(recentMonths(new Date('2027-01-10T15:00:00Z'), 3)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('usa el mes de Bogotá, no el de UTC', () => {
    // 1 de diciembre 04:30 UTC todavía es 30 de noviembre en Bogotá.
    expect(recentMonths(new Date('2026-12-01T04:30:00Z'), 1)).toEqual(['2026-11']);
  });
});

describe('buildMonthlySeries', () => {
  const now = new Date('2026-12-02T15:00:00Z');

  it('suma cobros y cuenta tiendas nuevas por mes de Bogotá', () => {
    const series = buildMonthlySeries(
      now,
      [
        { amountCop: 49000, createdAt: new Date('2026-11-02T15:00:00Z') },
        // 30 de noviembre 23:30 en Bogotá: todavía es noviembre.
        { amountCop: 10000, createdAt: new Date('2026-12-01T04:30:00Z') },
        // 1 de diciembre 00:30 en Bogotá.
        { amountCop: 99000, createdAt: new Date('2026-12-01T05:30:00Z') },
        // Fuera de la serie.
        { amountCop: 5000, createdAt: new Date('2026-06-10T15:00:00Z') },
      ],
      [
        // 31 de octubre 23:59 en Bogotá.
        { createdAt: new Date('2026-11-01T04:59:00Z') },
        // 1 de noviembre 00:01 en Bogotá.
        { createdAt: new Date('2026-11-01T05:01:00Z') },
        { createdAt: new Date('2026-12-02T15:00:00Z') },
      ],
    );

    expect(series).toEqual([
      { month: '2026-07', revenueCop: 0, newStores: 0, totalStores: 0 },
      { month: '2026-08', revenueCop: 0, newStores: 0, totalStores: 0 },
      { month: '2026-09', revenueCop: 0, newStores: 0, totalStores: 0 },
      { month: '2026-10', revenueCop: 0, newStores: 1, totalStores: 1 },
      { month: '2026-11', revenueCop: 59000, newStores: 1, totalStores: 2 },
      { month: '2026-12', revenueCop: 99000, newStores: 1, totalStores: 3 },
    ]);
  });

  it('acumula las tiendas al cierre de cada mes, también las anteriores a la serie', () => {
    const series = buildMonthlySeries(
      now,
      [],
      [
        // 15 de enero: antes de la ventana, cuenta en todos los meses.
        { createdAt: new Date('2026-01-15T15:00:00Z') },
        // 10 de octubre: no cuenta en julio, agosto ni septiembre.
        { createdAt: new Date('2026-10-10T15:00:00Z') },
      ],
    );

    expect(series.map((point) => point.totalStores)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('una tienda creada a medianoche de Bogotá del 1 de noviembre cuenta desde noviembre', () => {
    const series = buildMonthlySeries(now, [], [{ createdAt: new Date('2026-11-01T05:00:00Z') }]);

    expect(series.map((point) => point.totalStores)).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it('la serie acumulada nunca baja', () => {
    const series = buildMonthlySeries(
      now,
      [],
      [
        { createdAt: new Date('2026-02-01T15:00:00Z') },
        { createdAt: new Date('2026-08-20T15:00:00Z') },
        { createdAt: new Date('2026-12-02T15:00:00Z') },
      ],
    );
    const totals = series.map((point) => point.totalStores);

    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(totals).toEqual([1, 2, 2, 2, 2, 3]);
  });

  it('sin pagos ni tiendas devuelve la serie en ceros', () => {
    expect(buildMonthlySeries(now, [], [])).toHaveLength(6);
    expect(buildMonthlySeries(now, [], []).every((point) => point.revenueCop === 0)).toBe(true);
  });
});
