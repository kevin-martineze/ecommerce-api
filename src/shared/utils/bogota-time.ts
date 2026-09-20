/**
 * Colombia está en UTC−5 todo el año: no tiene horario de verano. Eso permite
 * calcular el inicio de mes local sin una librería de zonas horarias.
 *
 * Importa porque el servidor corre en UTC. Sin esto, entre las 7 p. m. del
 * último día del mes y la medianoche, las ventas de esas horas se contarían en
 * el mes siguiente.
 */
const BOGOTA_OFFSET_HOURS = 5;

export function startOfMonthInBogota(now: Date): Date {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_HOURS * 3_600_000);

  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, BOGOTA_OFFSET_HOURS));
}

/** El mes de Bogotá en que cae la fecha, como `YYYY-MM`. */
export function bogotaMonthKey(date: Date): string {
  const local = new Date(date.getTime() - BOGOTA_OFFSET_HOURS * 3_600_000);

  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Límites de un mes de Bogotá (`YYYY-MM`): desde su primer instante hasta el
 * primer instante del mes siguiente, exclusivo.
 */
export function bogotaMonthRange(month: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    throw new Error(`Mes inválido: "${month}". Usa YYYY-MM.`);
  }

  const year = Number(match[1]);
  const index = Number(match[2]) - 1;

  return {
    start: new Date(Date.UTC(year, index, 1, BOGOTA_OFFSET_HOURS)),
    end: new Date(Date.UTC(year, index + 1, 1, BOGOTA_OFFSET_HOURS)),
  };
}
