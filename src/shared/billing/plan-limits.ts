import { ForbiddenException } from '@nestjs/common';
import { TenantClient } from '@db/prisma.service';

/**
 * Límites del plan, aplicados donde se crea lo que el plan acota.
 *
 * Viven en `shared/` porque los aplican módulos distintos (catálogo, pedidos,
 * fotos) y tienen que fallar igual en todos: 403 con `error: plan_limit`, para
 * que el panel lo distinga de un permiso denegado y pueda ofrecer el cambio
 * de plan.
 *
 * `null` en el plan significa sin límite.
 */

export type PlanLimit = 'maxProducts' | 'maxOrdersPerMonth' | 'maxImagesPerProduct';

const MESSAGES: Record<PlanLimit, (limit: number) => string> = {
  maxProducts: (limit) => `Tu plan admite hasta ${limit} prendas.`,
  maxOrdersPerMonth: (limit) => `Tu plan admite hasta ${limit} pedidos por mes.`,
  maxImagesPerProduct: (limit) => `Tu plan admite hasta ${limit} fotos por prenda.`,
};

/**
 * Falla con 403 `plan_limit` si `current` ya alcanzó el límite del plan.
 *
 * Debe llamarse dentro de `forStore`: `subscriptions` está bajo RLS. Una tienda
 * sin suscripción (no debería existir) no tiene límite: mejor eso que dejarla
 * sin poder operar por un dato faltante.
 */
export async function assertWithinPlan(
  tx: TenantClient,
  storeId: string,
  limit: PlanLimit,
  current: number,
): Promise<void> {
  const subscription = await tx.subscription.findUnique({
    where: { storeId },
    // Los tres campos explícitos: con una clave calculada Prisma pierde el tipo.
    select: {
      plan: { select: { maxProducts: true, maxOrdersPerMonth: true, maxImagesPerProduct: true } },
    },
  });

  const max = subscription?.plan[limit] ?? null;

  if (max !== null && current >= max) {
    throw new ForbiddenException({
      message: MESSAGES[limit](max),
      error: 'plan_limit',
      details: { limit, max },
    });
  }
}
