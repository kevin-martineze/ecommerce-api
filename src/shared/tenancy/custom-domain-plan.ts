import { TenantClient } from '@db/prisma.service';

/**
 * Si el plan vigente de la tienda incluye dominio propio. Se pregunta en cada
 * lectura y no se guarda: cambiar de plan tiene que verse enseguida, igual que
 * el asistente.
 *
 * Debe llamarse dentro de `forStore`: `subscriptions` está bajo RLS.
 */
export async function planAllowsCustomDomain(tx: TenantClient, storeId: string): Promise<boolean> {
  const subscription = await tx.subscription.findUnique({
    where: { storeId },
    select: { plan: { select: { customDomain: true } } },
  });

  return subscription?.plan.customDomain ?? false;
}
