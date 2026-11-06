import { resolveTxt } from 'node:dns/promises';

/**
 * Prueba de propiedad: la tienda pone un TXT `_globerce.<host>` con su token.
 *
 * Sin esto, cualquier tienda podría registrar un dominio ajeno que todavía
 * apunta a Vercel (por ejemplo, de otra tienda que lo quitó) y quedarse con
 * él. El CNAME a Vercel es igual para todos; el TXT no.
 *
 * Detrás de una interfaz para poder simular el DNS en los tests.
 */

export interface TxtResolver {
  /** Los registros TXT de un nombre, cada uno como lista de trozos. Lanza si no hay registro. */
  resolveTxt(name: string): Promise<string[][]>;
}

/** El DNS real del sistema. */
export const systemTxtResolver: TxtResolver = {
  resolveTxt: (name) => resolveTxt(name),
};

/** Nombre completo donde va el TXT: `_globerce.www.tienda.com`. */
export function ownershipName(host: string): string {
  return `_globerce.${host}`;
}

/** Valor que tiene que contener el TXT. */
export function ownershipValue(token: string): string {
  return `globerce-verify=${token}`;
}

/**
 * ¿Está el token en el TXT del host? Un nombre sin registro (NXDOMAIN, sin
 * datos) cuenta como "no", no como error: es justo el estado de quien todavía
 * no lo puso.
 */
export async function hasOwnershipRecord(
  resolver: TxtResolver,
  host: string,
  token: string,
): Promise<boolean> {
  let records: string[][];

  try {
    records = await resolver.resolveTxt(ownershipName(host));
  } catch {
    return false;
  }

  const expected = ownershipValue(token);

  return records.some((parts) => parts.join('') === expected);
}
