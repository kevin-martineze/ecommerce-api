import { Prisma } from '@prisma/client';
import { StoreActivationDto } from '@shared/dtos/platform/platform.dto';
import { ACTIVATION_STAGES, ActivationStage } from '@shared/domains/activation';
import { TenantClient } from '@db/prisma.service';

/**
 * Los hitos de una tienda, cada uno con la fecha en que se cumplió la primera
 * vez. Son `null` mientras no se haya cumplido.
 */
export interface ActivationMilestones {
  createdAt: Date;
  /** Primer producto `ACTIVE` que tiene al menos una foto. */
  firstProductAt: Date | null;
  /** Primer pedido que no está cancelado. */
  firstOrderAt: Date | null;
  /** Primer pedido pagado o entregado. */
  firstSaleAt: Date | null;
  /** Primer pago que la plataforma registró: la tienda paga Globerce. */
  firstPaymentAt: Date | null;
}

export interface CurrentStage {
  stage: ActivationStage;
  /** Cuándo se cumplió esa etapa. Nunca es null: la etapa solo existe si hay fecha. */
  reachedAt: Date;
}

/**
 * La etapa más alta cumplida y la fecha en que se cumplió.
 *
 * Pura: sin base, sin reloj. Si se cumple una etapa alta sin la anterior (un
 * pago a mano sin pedidos), gana la alta; las fechas de las etapas bajas
 * quedan sin usar.
 */
export function currentStage(milestones: ActivationMilestones): CurrentStage {
  if (milestones.firstPaymentAt) {
    return { stage: 'paying', reachedAt: milestones.firstPaymentAt };
  }

  if (milestones.firstSaleAt) {
    return { stage: 'first_sale', reachedAt: milestones.firstSaleAt };
  }

  if (milestones.firstOrderAt) {
    return { stage: 'first_order', reachedAt: milestones.firstOrderAt };
  }

  if (milestones.firstProductAt) {
    return { stage: 'catalog', reachedAt: milestones.firstProductAt };
  }

  return { stage: 'created', reachedAt: milestones.createdAt };
}

/** Las etapas que una tienda en `stage` ya alcanzó, incluida esa. Para contar el embudo. */
export function stagesReachedBy(stage: ActivationStage): ActivationStage[] {
  return ACTIVATION_STAGES.slice(0, ACTIVATION_STAGES.indexOf(stage) + 1);
}

/** Pedidos que cuentan como venta: pagados o entregados. */
const SOLD_ORDERS = {
  OR: [{ paymentStatus: 'PAID' }, { status: 'DELIVERED' }],
} satisfies Prisma.OrderWhereInput;

/**
 * Lee los hitos de una tienda y arma su activación.
 *
 * Recibe el `tx` de `prisma.forStore`: `products`, `product_images`, `orders`,
 * `payments`, `store_settings` y `store_payment_accounts` están bajo RLS y sin
 * el contexto de la tienda devolverían cero filas. `refresh_tokens` no tiene
 * RLS: leerla dentro de la transacción da lo mismo que fuera, y así todo va
 * por una sola conexión.
 *
 * Solo pide columnas mínimas y agregados; nunca trae filas completas.
 */
export async function readActivation(
  tx: TenantClient,
  storeId: string,
  createdAt: Date,
): Promise<StoreActivationDto> {
  const withPhoto = { status: 'ACTIVE', images: { some: {} } } satisfies Prisma.ProductWhereInput;

  const firstProduct = await tx.product.aggregate({
    where: { storeId, ...withPhoto },
    _min: { createdAt: true },
  });
  const activeProductsWithPhoto = await tx.product.count({ where: { storeId, ...withPhoto } });

  const firstOrder = await tx.order.aggregate({
    where: { storeId, status: { not: 'CANCELLED' } },
    _min: { createdAt: true },
  });

  // La venta se marca con `coalesce(paidAt, updatedAt)`, que Prisma no puede
  // agregar en una sola consulta. Dos mínimos cubren el caso exacto: el mínimo
  // de `paidAt` entre las ventas que lo tienen, y el de `updatedAt` entre las
  // que no. El menor de los dos es la primera venta.
  const soldPaid = await tx.order.aggregate({
    where: { storeId, ...SOLD_ORDERS },
    _min: { paidAt: true },
  });
  const soldUnpaidDate = await tx.order.aggregate({
    where: { storeId, paidAt: null, ...SOLD_ORDERS },
    _min: { updatedAt: true },
  });

  const firstPayment = await tx.payment.aggregate({
    where: { storeId },
    _min: { createdAt: true },
  });

  const lastToken = await tx.refreshToken.findFirst({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const settings = await tx.storeSettings.findUnique({
    where: { storeId },
    select: { logoUrl: true, theme: true, whatsappPhone: true },
  });

  const account = await tx.storePaymentAccount.findFirst({
    where: { storeId, active: true },
    select: { storeId: true },
  });

  const milestones: ActivationMilestones = {
    createdAt,
    firstProductAt: firstProduct._min.createdAt,
    firstOrderAt: firstOrder._min.createdAt,
    firstSaleAt: earliest(soldPaid._min.paidAt, soldUnpaidDate._min.updatedAt),
    firstPaymentAt: firstPayment._min.createdAt,
  };
  const { stage, reachedAt } = currentStage(milestones);
  const phone = settings?.whatsappPhone.trim() ?? '';

  return {
    stage,
    stageReachedAt: reachedAt,
    firstProductAt: milestones.firstProductAt,
    firstOrderAt: milestones.firstOrderAt,
    firstSaleAt: milestones.firstSaleAt,
    firstPaymentAt: milestones.firstPaymentAt,
    lastSeenAt: lastToken?.createdAt ?? null,
    activeProductsWithPhoto,
    hasLogo: settings !== null && (settings.logoUrl !== null || settings.theme !== null),
    wompiConnected: account !== null,
    contactPhone: phone === '' ? null : phone,
  };
}

/** El más temprano de los que tienen fecha, o null si ninguno la tiene. */
function earliest(...dates: (Date | null)[]): Date | null {
  const present = dates.filter((date): date is Date => date !== null);

  if (present.length === 0) {
    return null;
  }

  return new Date(Math.min(...present.map((date) => date.getTime())));
}
