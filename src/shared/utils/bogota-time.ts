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
