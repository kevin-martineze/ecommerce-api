import { MonthlyPointDto } from '@shared/dtos/platform/platform.dto';
import { bogotaMonthKey, bogotaMonthRange } from '@shared/utils/bogota-time';

const DAY_MS = 86_400_000;

/** Cuántos meses trae la serie del resumen, el actual incluido. */
export const SERIES_MONTHS = 6;

/**
 * Los últimos `count` meses de Bogotá (`YYYY-MM`) que terminan en el actual,
 * del más viejo al más nuevo.
 */
export function recentMonths(now: Date, count: number = SERIES_MONTHS): string[] {
  const months: string[] = [];
  let month = bogotaMonthKey(now);

  for (let i = 0; i < count; i += 1) {
    months.unshift(month);
    month = bogotaMonthKey(new Date(bogotaMonthRange(month).start.getTime() - DAY_MS));
  }

  return months;
}

/**
 * Lo cobrado, las tiendas creadas y las tiendas acumuladas al cierre de cada mes
 * de la serie, en hora de Colombia. Lo cobrado y las tiendas nuevas fuera de la
 * serie se ignoran; las acumuladas cuentan también las tiendas anteriores a ella.
 */
export function buildMonthlySeries(
  now: Date,
  payments: { amountCop: number; createdAt: Date }[],
  stores: { createdAt: Date }[],
): MonthlyPointDto[] {
  const series = new Map<string, MonthlyPointDto>(
    recentMonths(now).map((month) => [
      month,
      { month, revenueCop: 0, newStores: 0, totalStores: 0 },
    ]),
  );

  for (const payment of payments) {
    const point = series.get(bogotaMonthKey(payment.createdAt));

    if (point) point.revenueCop += payment.amountCop;
  }

  for (const store of stores) {
    const point = series.get(bogotaMonthKey(store.createdAt));

    if (point) point.newStores += 1;
  }

  for (const [month, point] of series) {
    const end = bogotaMonthRange(month).end;

    point.totalStores = stores.filter((store) => store.createdAt < end).length;
  }

  return [...series.values()];
}
