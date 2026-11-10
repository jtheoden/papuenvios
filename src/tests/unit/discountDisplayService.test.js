import { describe, it, expect } from 'vitest';
import { buildDiscountBreakdown } from '@/lib/discountDisplayService';
import { calculateOrderTotal } from '@/lib/priceCalculationService';

describe('buildDiscountBreakdown matches calculateOrderTotal', () => {
  it('applies an offer whose min_purchase_amount equals the post-category subtotal despite float noise', () => {
    // 0.06 - 0.01 === 0.049999999999999996 in floating point
    const offer = { id: 'o', code: 'MIN', discount_type: 'percentage', discount_value: 50, min_purchase_amount: 0.05 };
    const params = { amount: 0.06, categoryPercent: 16.67, offer };

    const breakdown = buildDiscountBreakdown(params);
    const totals = calculateOrderTotal({ subtotal: 0.06, categoryDiscount: 16.67, offer });

    expect(totals.offerApplied).toBe(true);
    expect(breakdown.offer.amount).toBe(totals.offerDiscountAmount);
    expect(breakdown.category.amount).toBe(totals.categoryDiscountAmount);
    expect(breakdown.total.amount).toBe(totals.totalDiscount);
    expect(breakdown.finalAmount).toBe(totals.afterAllDiscounts);
  });

  it('agrees with the total for the 53.69 threshold case', () => {
    const offer = { id: 'o', code: 'MIN', discount_type: 'fixed_amount', discount_value: 5, min_purchase_amount: 53.69 };
    for (const base of [59.66, 59.65, 59.67, 100.1, 77.77]) {
      for (const categoryPercent of [3, 5, 7.5, 10]) {
        const breakdown = buildDiscountBreakdown({ amount: base, categoryPercent, offer });
        const totals = calculateOrderTotal({ subtotal: base, categoryDiscount: categoryPercent, offer });
        expect(breakdown.offer.amount, `${base}/${categoryPercent}`).toBe(totals.offerDiscountAmount);
        expect(breakdown.finalAmount, `${base}/${categoryPercent}`).toBe(totals.afterAllDiscounts);
      }
    }
  });
});
