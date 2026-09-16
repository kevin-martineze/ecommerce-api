import {
  computeTotals,
  couponDiscount,
  couponRejection,
  CouponRule,
  mergeLines,
  normalizeCouponCode,
} from './pricing';

const coupon = (overrides: Partial<CouponRule> = {}): CouponRule => ({
  type: 'PERCENT',
  value: 10,
  minSubtotal: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  uses: 0,
  active: true,
  ...overrides,
});

const now = new Date('2026-09-14T15:00:00Z');

describe('mergeLines', () => {
  it('suma la misma variante y descarta cantidades no positivas', () => {
    expect(
      mergeLines([
        { variantId: 'a', qty: 1 },
        { variantId: 'b', qty: 0 },
        { variantId: 'a', qty: 2 },
        { variantId: 'c', qty: -1 },
      ]),
    ).toEqual([{ variantId: 'a', qty: 3 }]);
  });
});

describe('cupones', () => {
  it('normaliza el código', () => {
    expect(normalizeCouponCode('  verano10 ')).toBe('VERANO10');
  });

  it('dice el primer motivo por el que no aplica', () => {
    expect(couponRejection(null, 1000, now)).toBe('not_found');
    expect(couponRejection(coupon({ active: false, maxUses: 1, uses: 1 }), 1000, now)).toBe(
      'inactive',
    );
    expect(couponRejection(coupon({ startsAt: new Date('2026-10-01T00:00:00Z') }), 1000, now)).toBe(
      'not_started',
    );
    expect(couponRejection(coupon({ endsAt: new Date('2026-09-01T00:00:00Z') }), 1000, now)).toBe(
      'expired',
    );
    expect(couponRejection(coupon({ maxUses: 3, uses: 3 }), 1000, now)).toBe('exhausted');
    expect(couponRejection(coupon({ minSubtotal: 50000 }), 49999, now)).toBe('min_subtotal');
    expect(couponRejection(coupon({ minSubtotal: 50000 }), 50000, now)).toBeNull();
  });

  it('el porcentaje redondea hacia abajo y ningún descuento supera el subtotal', () => {
    expect(couponDiscount({ type: 'PERCENT', value: 15 }, 99999)).toBe(14999);
    expect(couponDiscount({ type: 'FIXED', value: 30000 }, 20000)).toBe(20000);
  });
});

describe('computeTotals', () => {
  it('suma el envío mientras no se alcance el umbral', () => {
    expect(computeTotals(189000, 0, 8000, 200000)).toEqual({
      subtotal: 189000,
      discount: 0,
      shippingCost: 8000,
      total: 197000,
    });
  });

  it('el umbral se mide después del descuento', () => {
    expect(computeTotals(210000, 20000, 8000, 200000).shippingCost).toBe(8000);
    expect(computeTotals(220000, 20000, 8000, 200000).shippingCost).toBe(0);
  });

  it('sin umbral, siempre se cobra el envío', () => {
    expect(computeTotals(1_000_000, 0, 8000, null).shippingCost).toBe(8000);
  });
});
