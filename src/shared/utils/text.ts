/**
 * Texto opcional de un PATCH: vacío equivale a no tenerlo.
 *
 * `undefined` se conserva tal cual, porque en un PATCH significa "no lo
 * toques", mientras que `null` y `''` significan "quítalo".
 */
export function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === null || value === '' ? null : value;
}
