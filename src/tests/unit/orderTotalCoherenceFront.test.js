/**
 * RB-22 proof: the totals the checkout sends (CartPage -> createOrder) always satisfy the invariant
 * enforced by the DB guard guard_orders_total_coherence:
 *   total_amount > 0 AND |total - (subtotal - discount + shipping + tax)| <= 0.011
 * The pipeline is rebuilt exactly as CartPage does: buildCartLines -> calculateOrderTotal -> roundMoney on
 * each field (createOrder rounds again). tax_amount is never sent (createOrder: roundMoney(undefined) = 0).
 */
import { describe, it, expect } from 'vitest';
import { buildCartLines } from '@/lib/cartPricing';
import { calculateOrderTotal } from '@/lib/priceCalculationService';
import { roundMoney } from '@/lib/moneyPure';

const TOLERANCE = 0.011;

// Mirrors CartPage (orderData) + orderService.createOrder (the payload actually inserted).
const checkoutPayload = ({ quantities, prices, categoryDiscount = 0, offer = null, shippingCost = 0 }) => {
  const cart = quantities.map((quantity, i) => ({ quantity, i }));
  const { lines, subtotal } = buildCartLines(cart, (item) => prices[item.i]);
  const t = calculateOrderTotal({ subtotal, categoryDiscount, offer, shippingCost });
  return {
    subtotal: roundMoney(roundMoney(subtotal)),
    discount_amount: roundMoney(roundMoney(t.totalDiscount)),
    shipping_cost: roundMoney(roundMoney(shippingCost)),
    tax_amount: roundMoney(undefined),
    total_amount: roundMoney(roundMoney(t.total)),
    lineSum: roundMoney(lines.reduce((s, l) => s + l.totalPrice, 0))
  };
};

const coherent = (p) =>
  p.total_amount > 0 &&
  Math.abs(p.total_amount - (p.subtotal - p.discount_amount + p.shipping_cost + p.tax_amount)) <= TOLERANCE;

const pct = (v) => ({ id: 'o', discount_type: 'percentage', discount_value: v });
const fixed = (v, extra = {}) => ({ id: 'o', discount_type: 'fixed_amount', discount_value: v, ...extra });

describe('checkout totals vs DB coherence invariant', () => {
  it('realistic carts: category + offer discount, shipping, combos, multi-currency unit prices', () => {
    const cases = [
      { quantities: [3, 1, 7], prices: [12.99, 4.5, 3.333], cat: 5, offer: pct(10), ship: 7.5 },
      { quantities: [2, 1], prices: [19.99, 49.9], cat: 10, offer: fixed(5), ship: 0 },
      { quantities: [1], prices: [10.005], cat: 7.5, offer: pct(33.33), ship: 12.34 },
      // converted display currency (unconverted rate noise) and a stored combo price
      { quantities: [4, 2], prices: [8.1234, 21.4567], cat: 3, offer: pct(15), ship: 9.99 },
      { quantities: [1, 1], prices: [100, 0.01], cat: 0, offer: null, ship: 0 },
      { quantities: [5], prices: [0.07], cat: 15, offer: fixed(0.1, { max_discount_amount: 0.05 }), ship: 1 }
    ];
    for (const c of cases) {
      const p = checkoutPayload({
        quantities: c.quantities, prices: c.prices, categoryDiscount: c.cat, offer: c.offer, shippingCost: c.ship
      });
      expect(coherent(p), JSON.stringify(p)).toBe(true);
      expect(p.subtotal).toBe(p.lineSum);
    }
  });

  it('randomized sweep (20000 carts) never violates the invariant', () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let checked = 0;
    for (let i = 0; i < 20000; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const quantities = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 9));
      const prices = quantities.map(() => Math.round(rnd() * 20000) / 100 + rnd() * 0.0099);
      const categoryDiscount = [0, 3, 5, 7.5, 10, 12.5, 15][Math.floor(rnd() * 7)];
      const k = rnd();
      const offer = k < 0.4 ? null : k < 0.7 ? pct(Math.round(rnd() * 5000) / 100) : fixed(Math.round(rnd() * 3000) / 100);
      const shippingCost = rnd() < 0.3 ? 0 : Math.round(rnd() * 3000) / 100;
      const p = checkoutPayload({ quantities, prices, categoryDiscount, offer, shippingCost });
      if (p.total_amount <= 0) continue; // createOrder rejects total 0 before any insert
      checked++;
      expect(coherent(p), JSON.stringify(p)).toBe(true);
    }
    expect(checked).toBeGreaterThan(19000);
  });

  it('a 100% discount with free shipping gives total 0, which createOrder rejects before inserting', () => {
    const p = checkoutPayload({ quantities: [1], prices: [20], offer: pct(100), shippingCost: 0 });
    expect(p.total_amount).toBe(0); // createOrder: !orderData.totalAmount -> validation error, no INSERT
  });

  it('a 100% discount with paid shipping stays coherent (total = shipping)', () => {
    const p = checkoutPayload({ quantities: [1], prices: [20], offer: pct(100), shippingCost: 5 });
    expect(p.total_amount).toBe(5);
    expect(coherent(p)).toBe(true);
  });
});
