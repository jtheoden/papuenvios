import { describe, it, expect, vi } from 'vitest';
import { getCartItemUnitPrice } from '@/lib/cartPricing';

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

  it('prices a combo from baseTotalPrice with its own margin', () => {
    const item = { products: ['a', 'b'], baseTotalPrice: 100, profitMargin: 20 };
    expect(getCartItemUnitPrice(item, ctx())).toBeCloseTo(120, 10);
  });

  it('prices a combo with the global combo margin when it has none', () => {
    const item = { products: ['a'], baseTotalPrice: 100 };
    expect(getCartItemUnitPrice(item, ctx())).toBeCloseTo(135, 10);
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

  it('falls back to the legacy formula when final_price is missing', () => {
    const item = { base_price: 10, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBeCloseTo(14, 10);
  });

  it('falls back to the legacy formula when final_price is not a number', () => {
    const item = { base_price: 10, final_price: 'abc', base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBeCloseTo(14, 10);
  });

  it('prefers the displayed_price snapshot over final_price (detail page behaviour)', () => {
    const item = { displayed_price: 9, displayed_currency_id: USD, final_price: 1.45, base_currency_id: USD };
    expect(getCartItemUnitPrice(item, ctx())).toBe(9);
  });

  it('never applies final_price to a combo', () => {
    const item = { products: ['a'], baseTotalPrice: 100, final_price: 1 };
    expect(getCartItemUnitPrice(item, ctx())).toBeCloseTo(135, 10);
  });
});
