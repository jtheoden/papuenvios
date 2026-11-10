/**
 * Contract behind the orders_money_total_identity_chk CHECK (phase 1.5 S1): the order payload the client
 * builds from calculateOrderTotal must satisfy
 *   |total - (subtotal - discount + shipping + tax)| <= 0.01
 * for every combination of category discount, offer, shipping and subtotal, otherwise a legitimate checkout
 * would be rejected by the database.
 */
import { describe, it, expect } from 'vitest';
import { calculateOrderTotal } from '@/lib/priceCalculationService';
import { roundMoney } from '@/lib/moneyPure';

const SUBTOTALS = [0.01, 0.99, 1, 3.33, 9.99, 19.95, 33.33, 47.47, 99.99, 100, 123.45, 777.77, 1999.99];
const CATEGORY_PERCENTS = [0, 1, 5, 7.5, 10, 12.5, 15, 33.33, 50, 99, 100];
const OFFERS = [
  null,
  { id: 'o1', discount_type: 'percentage', discount_value: 10, is_active: true },
  { id: 'o2', discount_type: 'percentage', discount_value: 33, is_active: true },
  { id: 'o3', discount_type: 'percentage', discount_value: 100, is_active: true },
  { id: 'o4', discount_type: 'fixed', discount_value: 5, is_active: true },
  { id: 'o5', discount_type: 'fixed', discount_value: 7.77, is_active: true }
];
const SHIPPING = [0, 2.5, 7.99, 15, 20];

describe('order totals keep cent identity (orders_money_total_identity_chk)', () => {
  it('payload total matches subtotal - discount + shipping + tax within one cent over the whole grid', () => {
    let worst = 0;
    let cases = 0;
    for (const subtotal of SUBTOTALS) {
      for (const categoryDiscount of CATEGORY_PERCENTS) {
        for (const offer of OFFERS) {
          for (const shippingCost of SHIPPING) {
            const t = calculateOrderTotal({ subtotal, categoryDiscount, offer, shippingCost });
            const discount = roundMoney(t.totalDiscount);
            const payloadTotal = roundMoney(t.total);
            const drift = Math.abs(
              payloadTotal - (roundMoney(subtotal) - discount + roundMoney(shippingCost) + roundMoney(t.taxAmount))
            );
            worst = Math.max(worst, drift);
            cases += 1;
            // discount never above the subtotal (orders_money_discount_range_chk)
            expect(discount).toBeLessThanOrEqual(roundMoney(subtotal));
            expect(discount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(3000);
    expect(worst).toBeLessThanOrEqual(0.0100001);
  });
});
