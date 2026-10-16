import { describe, it, expect, vi } from 'vitest';
import { getCartItemUnitPrice, buildCartLines, withStoredComboPrice } from '@/lib/cartPricing';

const USD = 'usd-id';
const CUP = 'cup-id';

// 1 USD = 770 CUP, symmetric. Mirrors CurrencyContext.convertAmount(amount, fromId, toId).
const makeConvert = () =>
  vi.fn((amount, from, to) => {
    if (from === to) return amount;
    if (from === CUP && to === USD) return amount / 770;
    if (from === USD && to === CUP) return amount * 770;
    return amount;
  });

const ctx = (overrides = {}) => ({
  selectedCurrency: USD,
  baseCurrencyId: USD,
  convertAmount: makeConvert(),
  financialSettings: { productProfit: 40, comboProfit: 35 },
  ...overrides,
});

describe('getCartItemUnitPrice - existing behaviour (must not change)', () => {
  it('returns 0 for a missing item', () => {
    expect(getCartItemUnitPrice(null, ctx())).toBe(0);
  });

  it('uses the displayed_price snapshot as-is when it is in the selected currency', () => {
    const item = { displayed_price: 12.5, displayed_currency_id: USD, base_price: 1, final_price: 99 };
    expect(getCartItemUnitPrice(item, ctx())).toBe(12.5);
  });

  it('converts the displayed_price snapshot when it was taken in another currency', () => {
    const c = ctx({ selectedCurrency: CUP });
    const item = { displayed_price: 2, displayed_currency_id: USD };
    expect(getCartItemUnitPrice(item, c)).toBe(1540);
    expect(c.convertAmount).toHaveBeenCalledWith(2, USD, CUP);
  });

  it('uses calculated_price_usd when there is no displayed snapshot', () => {
    expect(getCartItemUnitPrice({ calculated_price_usd: '7.25' }, ctx())).toBe(7.25);
  });

});

describe('getCartItemUnitPrice - combos priced from the stored final price', () => {
  it('charges the combo finalPrice (base currency) without recomputing from cost fields', () => {
    const item = { products: ['a', 'b'], finalPrice: 120, baseTotalPrice: 1, profitMargin: 5 };
    expect(getCartItemUnitPrice(item, ctx())).toBe(120);
  });

  it('accepts the raw final_price column name as well', () => {
    expect(getCartItemUnitPrice({ products: ['a'], final_price: '44.5' }, ctx())).toBe(44.5);
  });

  it.each([
    ['missing', {}],
    ['zero (e.g. a combo stored with final_price 0.00)', { finalPrice: 0 }],
    ['negative', { finalPrice: -3 }],
    ['not a number', { finalPrice: 'abc' }]
  ])('fails closed (NaN, never 0) when the combo final price is %s', (_label, extra) => {
    expect(getCartItemUnitPrice({ products: ['a'], ...extra }, ctx())).toBeNaN();
  });

  it('does not fall back to baseTotalPrice and profitMargin for legacy cart entries', () => {
    const item = { products: ['a'], baseTotalPrice: 100, profitMargin: 20 };
    expect(getCartItemUnitPrice(item, ctx())).toBeNaN();
  });
});

describe('getCartItemUnitPrice - product added from the catalog list (no price snapshot)', () => {
  it('charges the catalog final_price, not base_price with the global margin', () => {
    // Product margin is 45 %, global margin is 40 %. The catalog shows 1.45.
    const item = { id: 'p1', base_price: 1, profit_margin: 45, final_price: 1.45, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBe(1.45);
  });

  it('does not depend on the global product margin when final_price exists', () => {
    const item = { id: 'p1', base_price: 10, profit_margin: 25, final_price: 12.5, base_currency_id: USD };
    const low = getCartItemUnitPrice(item, ctx({ financialSettings: { productProfit: 5 } }));
    const high = getCartItemUnitPrice(item, ctx({ financialSettings: { productProfit: 90 } }));
    expect(low).toBe(12.5);
    expect(high).toBe(12.5);
  });

  it('does not convert when the product is already in the base currency', () => {
    const c = ctx();
    const item = { final_price: 3.2, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, c)).toBe(3.2);
    expect(c.convertAmount).not.toHaveBeenCalled();
  });

  it('converts a product priced in another currency to the base currency, rounded to 2 decimals', () => {
    const c = ctx();
    const item = { final_price: 1000, base_currency_id: CUP };
    // 1000 CUP / 770 = 1.2987... -> 1.30 (what the catalog shows after toFixed(2))
    expect(getCartItemUnitPrice(item, c)).toBe(1.3);
    expect(c.convertAmount).toHaveBeenCalledWith(1000, CUP, USD);
  });

  it('keeps the base-currency result even when the selected currency is not the base one', () => {
    const c = ctx({ selectedCurrency: CUP });
    const item = { final_price: 2, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, c)).toBe(2);
  });

  it('fails closed (NaN, never a base_price fallback or 0) when final_price is missing', () => {
    const item = { base_price: 10, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBeNaN();
  });

  it('fails closed (NaN) when final_price is not a number', () => {
    const item = { base_price: 10, final_price: 'abc', base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBeNaN();
  });

  it('fails closed (NaN) when final_price is 0', () => {
    expect(getCartItemUnitPrice({ final_price: 0, base_currency_id: USD }, ctx())).toBeNaN();
  });

  it('fails closed (NaN) when the currency conversion cannot be resolved', () => {
    const c = ctx({ convertAmount: vi.fn(() => NaN) });
    expect(getCartItemUnitPrice({ final_price: 5, base_currency_id: CUP }, c)).toBeNaN();
  });

  it('prefers the displayed_price snapshot over final_price (detail page behaviour)', () => {
    const item = { displayed_price: 9, displayed_currency_id: USD, final_price: 1.45, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBe(9);
  });

});

describe('getCartItemUnitPrice - cent rounding at source', () => {
  it('rounds the combo final price half-up (44.805 -> 44.81)', () => {
    const item = { products: [{}], finalPrice: 44.805 };
    expect(getCartItemUnitPrice(item, ctx())).toBe(44.81);
  });

  it('rounds the calculated_price_usd branch', () => {
    expect(getCartItemUnitPrice({ calculated_price_usd: '10.005' }, ctx())).toBe(10.01);
  });

  it('rounds the displayed_price branch in the selected currency', () => {
    const item = { displayed_price: '12.345', displayed_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBe(12.35);
  });

  it('does not turn a non-numeric price into 0 (returns NaN so the cart can fail closed)', () => {
    expect(getCartItemUnitPrice({ displayed_price: 'x', displayed_currency_id: USD }, ctx())).toBeNaN();
    expect(getCartItemUnitPrice({ calculated_price_usd: 'x' }, ctx())).toBeNaN();
    const c = ctx({ selectedCurrency: CUP, convertAmount: () => NaN });
    expect(getCartItemUnitPrice({ displayed_price: 2, displayed_currency_id: USD }, c)).toBeNaN();
  });

  it('rounds the displayed_price branch AFTER currency conversion', () => {
    // 1000 CUP / 770 = 1.2987... -> 1.30
    const item = { displayed_price: 1000, displayed_currency_id: CUP };
    expect(getCartItemUnitPrice(item, ctx())).toBe(1.3);
  });
});

describe('buildCartLines - rounded lines and subtotal', () => {
  const unit = (item) => item.unit;

  it('rounds each line total and sums the rounded lines', () => {
    const cart = [
      { id: 'a', quantity: 27, unit: 0.55 },
      { id: 'b', quantity: 1, unit: 44.81 },
      { id: 'c', quantity: 3, unit: 10.335 },
    ];
    const { lines, subtotal } = buildCartLines(cart, unit);
    // 10.335 -> unit 10.34 first, then 10.34 * 3
    expect(lines.map((l) => l.totalPrice)).toEqual([14.85, 44.81, 31.02]);
    expect(subtotal).toBe(90.68);
  });

  it('keeps unitPrice cent-rounded and totalPrice == round2(unitPrice * quantity)', () => {
    const { lines } = buildCartLines([{ id: 'a', quantity: 27, unit: 0.5459 }], unit);
    expect(lines[0].unitPrice).toBe(0.55);
    expect(lines[0].totalPrice).toBe(14.85);
  });

  it('flags a missing or invalid quantity instead of silently charging 0', () => {
    const { lines, hasInvalidLines } = buildCartLines([{ id: 'a', unit: 5 }, { id: 'b', quantity: 'x', unit: 5 }, { id: 'c', quantity: 0, unit: 5 }], unit);
    expect(lines.map((l) => l.invalid)).toEqual([true, true, true]);
    expect(hasInvalidLines).toBe(true);
  });

  it('flags a line whose unit price is not a finite number (fail closed)', () => {
    const cart = [{ id: 'a', quantity: 1, unit: 10 }, { id: 'b', quantity: 1, unit: NaN }];
    const { lines, hasInvalidLines } = buildCartLines(cart, unit);
    expect(lines.map((l) => l.invalid)).toEqual([false, true]);
    expect(hasInvalidLines).toBe(true);
  });

  it('does not flag a legitimately free (0) unit price', () => {
    const { hasInvalidLines } = buildCartLines([{ id: 'a', quantity: 1, unit: 0 }], unit);
    expect(hasInvalidLines).toBe(false);
  });

  it('returns zero subtotal for an empty or invalid cart', () => {
    expect(buildCartLines([], unit)).toEqual({ lines: [], subtotal: 0, hasInvalidLines: false });
    expect(buildCartLines(undefined, unit)).toEqual({ lines: [], subtotal: 0, hasInvalidLines: false });
  });

  it('works end to end with getCartItemUnitPrice on a mixed cart', () => {
    const cart = [
      { id: 'combo', quantity: 2, products: [{}], finalPrice: 44.805 },
      { id: 'prod', quantity: 27, final_price: 0.5459, base_currency_id: USD },
      { id: 'cat', quantity: 3, final_price: 1.45, base_currency_id: USD },
    ];
    const c = ctx();
    const { lines, subtotal } = buildCartLines(cart, (item) => getCartItemUnitPrice(item, c));
    const sumOfLines = Math.round(lines.reduce((a, l) => a + l.totalPrice, 0) * 100) / 100;
    expect(subtotal).toBe(sumOfLines);
    lines.forEach((l) => {
      expect(Math.round(l.unitPrice * 100)).toBeCloseTo(l.unitPrice * 100, 6);
      expect(Math.round(l.totalPrice * 100)).toBeCloseTo(l.totalPrice * 100, 6);
    });
    expect(lines[0].unitPrice).toBe(44.81);
    expect(lines[0].totalPrice).toBe(89.62);
  });
});

describe('withStoredComboPrice - combos added to the cart before the stored price was carried', () => {
  const stale = { id: 'c1', products: ['a'], baseTotalPrice: 100, profitMargin: 20, quantity: 2 };

  it('takes the stored finalPrice from the live catalog combo with the same id', () => {
    const hydrated = withStoredComboPrice(stale, [{ id: 'c1', finalPrice: 66.5 }, { id: 'c2', finalPrice: 1 }]);
    expect(hydrated.finalPrice).toBe(66.5);
    expect(getCartItemUnitPrice(hydrated, ctx())).toBe(66.5);
    expect(hydrated.quantity).toBe(2);
  });

  it('stays unpriced (NaN) when the combo is no longer in the catalog', () => {
    const hydrated = withStoredComboPrice(stale, [{ id: 'other', finalPrice: 9 }]);
    expect(getCartItemUnitPrice(hydrated, ctx())).toBeNaN();
  });

  it('stays unpriced when the catalog combo has no usable price either', () => {
    const hydrated = withStoredComboPrice(stale, [{ id: 'c1', finalPrice: '0.00' }]);
    expect(getCartItemUnitPrice(hydrated, ctx())).toBeNaN();
  });

  it('never replaces a price the item already carries, and ignores products', () => {
    const priced = { id: 'c1', products: ['a'], finalPrice: 10 };
    expect(withStoredComboPrice(priced, [{ id: 'c1', finalPrice: 99 }])).toBe(priced);
    const product = { id: 'p1', final_price: 3 };
    expect(withStoredComboPrice(product, [{ id: 'p1', finalPrice: 99 }])).toBe(product);
  });

  it('tolerates a missing catalog', () => {
    expect(getCartItemUnitPrice(withStoredComboPrice(stale, undefined), ctx())).toBeNaN();
  });
});
