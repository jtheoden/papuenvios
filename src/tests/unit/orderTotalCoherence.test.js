import { describe, it, expect } from 'vitest';
import { getOrderTotalWarning } from '@/lib/orderTotalCoherence';

const order = (o = {}, items = [{ total_price: 30 }, { total_price: 20 }]) => ({
  subtotal: 50, discount_amount: 5, shipping_cost: 7.5, tax_amount: 0, total_amount: 52.5, order_items: items, ...o
});

describe('getOrderTotalWarning', () => {
  it('returns null for a coherent order', () => {
    expect(getOrderTotalWarning(order())).toBeNull();
  });

  it.each([0.998, 0.999, 1.0, 1.001, 1.002])('historical rounding noise (items = subtotal x %s) does not warn', (ratio) => {
    const o = order({ subtotal: 208.33, discount_amount: 0, shipping_cost: 0, total_amount: 208.33 },
      [{ total_price: Math.round(208.33 * ratio * 100) / 100 }]);
    expect(getOrderTotalWarning(o)).toBeNull();
  });

  it('warns when the total is 0.01 against a 50 subtotal', () => {
    expect(getOrderTotalWarning(order({ discount_amount: 0, shipping_cost: 0, total_amount: 0.01 }))).toBe('total_below_formula');
  });

  it('does not warn when the total is one cent below the formula', () => {
    expect(getOrderTotalWarning(order({ total_amount: 52.49 }))).toBeNull();
  });

  it('warns when the subtotal is far from the sum of the items', () => {
    expect(getOrderTotalWarning(order({ subtotal: 0.01, discount_amount: 0, shipping_cost: 0, total_amount: 0.01 })))
      .toBe('subtotal_mismatch');
  });

  it('uses a 0.05 floor for small orders', () => {
    const small = { subtotal: 2, discount_amount: 0, shipping_cost: 0, total_amount: 2 };
    expect(getOrderTotalWarning(order(small, [{ total_price: 2.04 }]))).toBeNull();
    expect(getOrderTotalWarning(order(small, [{ total_price: 2.06 }]))).toBe('subtotal_mismatch');
  });

  it.each([undefined, null])('does not warn when the items are not loaded (%j)', (items) => {
    expect(getOrderTotalWarning({ ...order(), order_items: items })).toBeNull();
  });

  it('warns when the items are loaded and empty', () => {
    expect(getOrderTotalWarning({ ...order(), order_items: [] })).toBe('items_missing');
  });

  it('handles combos and numeric strings from PostgREST', () => {
    const o = order({ subtotal: '50.00', discount_amount: '5.00', shipping_cost: '7.50', tax_amount: null, total_amount: '52.50' },
      [{ item_type: 'combo', total_price: '30.00' }, { item_type: 'product', total_price: '20.00' }]);
    expect(getOrderTotalWarning(o)).toBeNull();
  });

  it('warns on a missing total', () => {
    expect(getOrderTotalWarning(order({ total_amount: null }))).toBe('total_below_formula');
  });

  it('a total ABOVE the formula is not flagged (only the underpayment risk is)', () => {
    expect(getOrderTotalWarning(order({ total_amount: 80 }))).toBeNull();
  });

  it('returns null for a missing order', () => {
    expect(getOrderTotalWarning(null)).toBeNull();
  });
});
