import { Transform } from 'class-transformer';

/**
 * Recorta espacios. Lo que no es texto pasa intacto, para que el validador lo
 * rechace con su propio mensaje en lugar de convertirlo en algo que sí valide.
 */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Igual que `Trim`, y además en mayúsculas. Para tallas: "m" y "M" son la misma. */
export const TrimUpperCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

/**
 * Lista de query string. `?color=a&color=b` llega como array, pero `?color=a`
 * llega como texto: se normaliza siempre a array para validar con `each`.
 */
export const QueryArray = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  );

/** Entero de query string. Lo que no son solo dígitos pasa intacto para que `IsInt` lo rechace. */
export const QueryInt = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  );

/**
 * Booleano de query string: `?x=true` o `?x=1`.
 *
 * El pipe global corre con `enableImplicitConversion` apagado, así que en la
 * query todo llega como texto, y `"false"` sería un string no vacío.
 */
export const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) => value === true || value === 'true' || value === '1');
