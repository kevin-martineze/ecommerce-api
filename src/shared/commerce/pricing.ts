/**
 * Reglas de precio del carrito y del pedido.
 *
 * Son funciones puras, y es a propósito. La cotización del carrito y la
 * creación del pedido usan las mismas reglas, y en la versión con Supabase
 * vivían duplicadas —en TypeScript para la vista previa y en plpgsql para el
 * pedido— con un comentario pidiendo cambiarlas en los dos lados. Acá hay un
 * solo lugar, y se prueba sin base de datos.
 */

/** Tope por línea. El mismo que aplicaba el carrito y `create_order`. */
export const MAX_QTY_PER_LINE = 20;

export interface CartLineInput {
  variantId: string;
  qty: number;
}

/** Suma cantidades de la misma variante y descarta las no positivas. Conserva el orden de aparición. */
export function mergeLines(lines: readonly CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, number>();

  for (const line of lines) {
    if (line.qty > 0) {
      merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.qty);
    }
  }

  return [...merged.entries()].map(([variantId, qty]) => ({ variantId, qty }));
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface CouponRule {
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
}

export type CouponRejection =
  'not_found' | 'inactive' | 'not_started' | 'expired' | 'exhausted' | 'min_subtotal';

/** Los mismos textos que mostraba la tienda. */
export const COUPON_REJECTION_MESSAGE: Record<CouponRejection, string> = {
  not_found: 'Ese código no existe.',
  inactive: 'Ese cupón ya no está activo.',
  not_started: 'Ese cupón todavía no empieza.',
  expired: 'Ese cupón ya venció.',
  exhausted: 'Ese cupón alcanzó su límite de usos.',
  min_subtotal: 'Tu pedido no alcanza el mínimo del cupón.',
};

/**
 * Por qué un cupón no aplica, o null si aplica.
 *
 * Mismo orden de chequeo que `coupon_rejection` en Supabase: a la clienta se le
 * dice el primer motivo, y "no existe" gana a "venció".
 */
export function couponRejection(
  coupon: CouponRule | null,
  subtotal: number,
  now: Date,
): CouponRejection | null {
  if (!coupon) {
    return 'not_found';
  }

  if (!coupon.active) {
    return 'inactive';
  }

  if (coupon.startsAt && now < coupon.startsAt) {
    return 'not_started';
  }

  if (coupon.endsAt && now > coupon.endsAt) {
    return 'expired';
  }

  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) {
    return 'exhausted';
  }

  if (subtotal < coupon.minSubtotal) {
    return 'min_subtotal';
  }

  return null;
}

/** Descuento en pesos enteros. Nunca supera el subtotal; el porcentaje redondea hacia abajo. */
export function couponDiscount(
  coupon: Pick<CouponRule, 'type' | 'value'>,
  subtotal: number,
): number {
  const raw =
    coupon.type === 'PERCENT' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;

  return Math.min(subtotal, raw);
}

export interface Totals {
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
}

/**
 * El total del pedido.
 *
 * El envío es gratis cuando lo que se paga por las prendas —subtotal menos
 * descuento— alcanza el umbral de la tienda. El resultado cumple por
 * construcción el CHECK `orders_total_matches_breakdown`.
 */
export function computeTotals(
  subtotal: number,
  discount: number,
  zoneCost: number,
  freeShippingThreshold: number | null,
): Totals {
  const appliedDiscount = Math.min(discount, subtotal);
  const reachesThreshold =
    freeShippingThreshold !== null && subtotal - appliedDiscount >= freeShippingThreshold;
  const shippingCost = reachesThreshold ? 0 : zoneCost;

  return {
    subtotal,
    discount: appliedDiscount,
    shippingCost,
    total: subtotal - appliedDiscount + shippingCost,
  };
}
