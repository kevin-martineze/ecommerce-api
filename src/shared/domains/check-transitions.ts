import type { CustomDomainStatus } from '@prisma/client';

/**
 * Un `pending` que nadie verificó en 7 días se libera: así nadie acapara un
 * host con un 409 para siempre.
 */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CheckOutcome = { kind: 'set'; status: CustomDomainStatus } | { kind: 'release' };

/**
 * Qué pasa con un dominio en el chequeo diario, según si hoy está bien:
 *
 * - bien → `active`, venga de donde venga (pendiente o fallido);
 * - mal y estaba `active` o `failed` → `failed`;
 * - mal y `pending` → sigue `pending`, salvo que tenga más de 7 días: entonces se libera.
 */
export function checkOutcome(input: {
  current: CustomDomainStatus;
  ok: boolean;
  addedAt: Date | null;
  now: Date;
}): CheckOutcome {
  if (input.ok) return { kind: 'set', status: 'ACTIVE' };

  if (input.current === 'PENDING') {
    const expired =
      input.addedAt !== null && input.now.getTime() - input.addedAt.getTime() > PENDING_TTL_MS;

    return expired ? { kind: 'release' } : { kind: 'set', status: 'PENDING' };
  }

  return { kind: 'set', status: 'FAILED' };
}
