import { describe, it, expect } from 'vitest';
import {
  calculatePriceWithMargin,
  convertPrice,
  calculateDiscount,
  applyDiscount,
  calculateCompletePrice,
  calculateCartSubtotal,
  applyOffer,
  getUserCategoryDiscount,
  calculateOrderTotal,
  formatPrice,
  formatPriceWithCode,
} from '@/lib/priceCalculationService';

// ─── calculatePriceWithMargin ───────────────────────────────────────────────

describe('calculatePriceWithMargin', () => {
  it('applies 40% default margin', () => {
    expect(calculatePriceWithMargin(100)).toBe(140);
  });

  it('applies custom margin', () => {
    expect(calculatePriceWithMargin(100, 25)).toBe(125);
  });

  it('clamps margin to [0, 100]', () => {
    expect(calculatePriceWithMargin(100, 150)).toBe(200);
    expect(calculatePriceWithMargin(100, -10)).toBe(100);
  });

  it('returns 0 for invalid input', () => {
    expect(calculatePriceWithMargin(0)).toBe(0);
    expect(calculatePriceWithMargin(null)).toBe(0);
    expect(calculatePriceWithMargin(NaN)).toBe(0);
  });
});

// ─── convertPrice ───────────────────────────────────────────────────────────

describe('convertPrice', () => {
  it('converts with exchange rate', () => {
    expect(convertPrice(100, 1, 24)).toBe(2400);
  });

  it('same currency returns same amount', () => {
    expect(convertPrice(50, 1, 1)).toBe(50);
  });

  it('returns 0 for invalid inputs', () => {
    expect(convertPrice(0, 1, 24)).toBe(0);
    expect(convertPrice(100, 0, 24)).toBe(0);
    expect(convertPrice(NaN, 1, 1)).toBe(0);
  });
});

// ─── calculateDiscount ──────────────────────────────────────────────────────

describe('calculateDiscount', () => {
  it('calculates 10% discount correctly', () => {
    expect(calculateDiscount(200, 10)).toBe(20);
  });

  it('caps discount at 100%', () => {
    expect(calculateDiscount(100, 150)).toBe(100);
  });

  it('returns 0 for no discount', () => {
    expect(calculateDiscount(100, 0)).toBe(0);
    expect(calculateDiscount(0, 10)).toBe(0);
  });
});

// ─── applyDiscount ──────────────────────────────────────────────────────────

describe('applyDiscount', () => {
  it('reduces price by discount amount', () => {
    expect(applyDiscount(100, 20)).toBe(80);
  });

  it('returns original price with 0% discount', () => {
    expect(applyDiscount(100, 0)).toBe(100);
  });
});

// ─── calculateCompletePrice ─────────────────────────────────────────────────

describe('calculateCompletePrice', () => {
  it('returns full breakdown with all modifiers', () => {
    const result = calculateCompletePrice({ basePrice: 100, profitMargin: 40, discount: 10, exchangeRate: 1 });
    expect(result.basePrice).toBe(100);
    expect(result.beforeDiscount).toBe(140);
    expect(result.discountAmount).toBe(14);
    expect(result.finalPrice).toBe(126);
  });

  it('returns null for invalid base price', () => {
    expect(calculateCompletePrice({ basePrice: 0 })).toBeNull();
    expect(calculateCompletePrice({})).toBeNull();
  });
});

// ─── calculateCartSubtotal ──────────────────────────────────────────────────

describe('calculateCartSubtotal', () => {
  it('sums items correctly', () => {
    const items = [
      { price: 10, quantity: 2 },
      { price: 5, quantity: 3 },
    ];
    expect(calculateCartSubtotal(items)).toBe(35);
  });

  it('returns 0 for empty cart', () => {
    expect(calculateCartSubtotal([])).toBe(0);
    expect(calculateCartSubtotal()).toBe(0);
  });

  it('uses getPriceForItem when provided', () => {
    const items = [{ id: 1, quantity: 2 }];
    expect(calculateCartSubtotal(items, () => 15)).toBe(30);
  });
});

// ─── applyOffer ─────────────────────────────────────────────────────────────

describe('applyOffer', () => {
  it('applies percentage offer', () => {
    const offer = { id: '1', discount_type: 'percentage', discount_value: 10 };
    const result = applyOffer(100, offer);
    expect(result.offerApplied).toBe(true);
    expect(result.discountAmount).toBe(10);
    expect(result.finalSubtotal).toBe(90);
  });

  it('applies fixed_amount offer', () => {
    const offer = { id: '2', discount_type: 'fixed_amount', discount_value: 15 };
    const result = applyOffer(100, offer);
    expect(result.discountAmount).toBe(15);
    expect(result.finalSubtotal).toBe(85);
  });

  it('rejects offer below minimum purchase', () => {
    const offer = { id: '3', discount_type: 'percentage', discount_value: 10, min_purchase_amount: 200 };
    const result = applyOffer(100, offer);
    expect(result.offerApplied).toBe(false);
    expect(result.finalSubtotal).toBe(100);
  });

  it('caps at max_discount_amount', () => {
    const offer = { id: '4', discount_type: 'percentage', discount_value: 50, max_discount_amount: 20 };
    const result = applyOffer(100, offer);
    expect(result.discountAmount).toBe(20);
  });

  it('returns no discount when no offer', () => {
    const result = applyOffer(100, null);
    expect(result.offerApplied).toBe(false);
    expect(result.discountAmount).toBe(0);
  });

  it('fixed_amount cannot exceed subtotal', () => {
    const offer = { id: '5', discount_type: 'fixed_amount', discount_value: 200 };
    const result = applyOffer(50, offer);
    expect(result.discountAmount).toBe(50);
    expect(result.finalSubtotal).toBe(0);
  });
});

// ─── getUserCategoryDiscount ─────────────────────────────────────────────────

describe('getUserCategoryDiscount', () => {
  it('returns discount for valid category', () => {
    expect(getUserCategoryDiscount('vip', 15)).toBe(15);
    expect(getUserCategoryDiscount('pro', 8)).toBe(8);
  });

  it('clamps discount to [0, 100]', () => {
    expect(getUserCategoryDiscount('vip', 150)).toBe(100);
    expect(getUserCategoryDiscount('vip', -5)).toBe(0);
  });

  it('returns 0 for invalid category', () => {
    expect(getUserCategoryDiscount('unknown', 20)).toBe(20);
  });
});

// ─── calculateOrderTotal ─────────────────────────────────────────────────────

describe('calculateOrderTotal', () => {
  it('computes full order with category discount and shipping', () => {
    const result = calculateOrderTotal({ subtotal: 100, categoryDiscount: 10, shippingCost: 5 });
    expect(result.categoryDiscountAmount).toBe(10);
    expect(result.afterCategoryDiscount).toBe(90);
    expect(result.shippingCost).toBe(5);
    expect(result.total).toBe(95);
  });

  it('applies offer after category discount', () => {
    const offer = { id: '1', discount_type: 'percentage', discount_value: 10 };
    const result = calculateOrderTotal({ subtotal: 100, categoryDiscount: 0, offer, shippingCost: 0 });
    expect(result.offerApplied).toBe(true);
    expect(result.total).toBe(90);
  });

  it('returns 0 total for empty input', () => {
    const result = calculateOrderTotal();
    expect(result.total).toBe(0);
  });
});

// ─── formatPrice / formatPriceWithCode ───────────────────────────────────────

describe('formatPrice', () => {
  it('formats with default dollar sign', () => {
    expect(formatPrice(10)).toBe('$10.00');
    expect(formatPrice(9.5)).toBe('$9.50');
  });

  it('uses custom currency symbol', () => {
    expect(formatPrice(100, '€')).toBe('€100.00');
  });

  it('handles invalid input', () => {
    expect(formatPrice(NaN)).toBe('$0.00');
    expect(formatPrice('abc')).toBe('$0.00');
  });
});

describe('formatPriceWithCode', () => {
  it('formats with currency code', () => {
    expect(formatPriceWithCode(100, 'USD')).toBe('100.00 USD');
    expect(formatPriceWithCode(50.5, 'CUP')).toBe('50.50 CUP');
  });

  it('handles invalid input', () => {
    expect(formatPriceWithCode(NaN, 'USD')).toBe('0.00 USD');
  });
});
