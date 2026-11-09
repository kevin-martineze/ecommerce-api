import type { CustomDomainStatus } from '@prisma/client';

/** El estado tal como lo ve la dueña y el frontend. `disabled` lo calcula la API según el plan. */
export type DomainStatusView = 'pending' | 'active' | 'failed' | 'disabled';

/**
 * El estado que se muestra. Si el plan ya no incluye dominio
 * propio, `disabled` aunque la base diga otra cosa: el dato se conserva por si
 * vuelve a contratar, pero no se sirve.
 */
export function domainStatusView(
  status: CustomDomainStatus,
  planAllowsCustomDomain: boolean,
): DomainStatusView {
  if (!planAllowsCustomDomain) return 'disabled';

  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'ACTIVE':
      return 'active';
    case 'FAILED':
      return 'failed';
  }
}
