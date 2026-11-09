import { resolveTxt } from 'node:dns/promises';

import { DomainProviderError } from './domain-provider';

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

/** Lo que node:dns devuelve cuando el nombre no existe (ENOTFOUND, NXDOMAIN) o no tiene TXT (ENODATA). */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA']);

const DNS_UNAVAILABLE = 'No pudimos revisar el DNS ahora. Intenta de nuevo en unos minutos.';

/**
 * ¿Está el token en el TXT del host? Un nombre sin registro cuenta como "no":
 * es justo el estado de quien todavía no lo puso. Cualquier otro error (timeout,
 * SERVFAIL, red) NO es "no": se relanza, para que un tropiezo del resolvedor no
 * baje un dominio activo a fallido.
 */
export async function hasOwnershipRecord(
  resolver: TxtResolver,
  host: string,
  token: string,
): Promise<boolean> {
  let records: string[][];

  try {
    records = await resolver.resolveTxt(ownershipName(host));
  } catch (cause) {
    if (isNoRecord(cause)) return false;

    throw new DomainProviderError('unavailable', DNS_UNAVAILABLE);
  }

  const expected = ownershipValue(token);

  return records.some((parts) => parts.join('') === expected);
}

function isNoRecord(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    NO_RECORD.has(cause.code)
  );
}
