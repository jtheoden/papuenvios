import { describe, it, expect, vi } from 'vitest';
import {
  resolveProductPrice,
  resolveComboPrice,
  getProductPriceInCurrency,
  getComboPriceInCurrency
} from '@/lib/publicPricing';

const USD = 'usd-id';
const CUP = 'cup-id';

const convert = vi.fn((amount, from, to) => {
  if (from === to) return amount;
  if (from === USD && to === CUP) return amount * 770;
  if (from === CUP && to === USD) return amount / 770;
  return NaN;
});

describe('resolveProductPrice', () => {
  it('reads the stored final_price', () => {
    expect(resolveProductPrice({ final_price: '12.50' })).toBe(12.5);
    expect(resolveProductPrice({ final_price: 3 })).toBe(3);
  });

  it.each([
    ['missing', {}],
    ['null', { final_price: null }],
    ['zero', { final_price: 0 }],
    ['negative', { final_price: -1 }],
    ['not numeric', { final_price: 'abc' }],
    ['infinite', { final_price: Infinity }]
  ])('returns null (never 0) when final_price is %s', (_label, product) => {
    expect(resolveProductPrice(product)).toBeNull();
  });

  it('never falls back to a cost field', () => {
    expect(resolveProductPrice({ base_price: 10, profit_margin: 40 })).toBeNull();
  });

  it('returns null for a missing product', () => {
    expect(resolveProductPrice(undefined)).toBeNull();
  });
});

describe('resolveComboPrice', () => {
  it('reads finalPrice (UI shape) or final_price (raw row)', () => {
    expect(resolveComboPrice({ finalPrice: '99.99' })).toBe(99.99);
    expect(resolveComboPrice({ final_price: 45 })).toBe(45);
  });

  it('prefers finalPrice over final_price when both exist', () => {
    expect(resolveComboPrice({ finalPrice: 10, final_price: 20 })).toBe(10);
  });

  it.each([
    ['missing', {}],
    ['zero (combo stored with final_price 0.00)', { finalPrice: '0.00' }],
    ['negative', { finalPrice: -5 }],
    ['not numeric', { finalPrice: 'x' }]
  ])('returns null (never 0) when the combo price is %s', (_label, combo) => {
    expect(resolveComboPrice(combo)).toBeNull();
  });

  it('never recomputes from component or cost fields', () => {
    expect(resolveComboPrice({ baseTotalPrice: 100, profitMargin: 20, products: ['a'] })).toBeNull();
  });
});

describe('getProductPriceInCurrency', () => {
  it('returns the price untouched when the product currency is the selected one', () => {
    expect(getProductPriceInCurrency(
      { final_price: 5, base_currency_id: USD },
      { convert, selectedCurrencyId: USD }
    )).toBe(5);
  });

  it('converts from the product currency to the selected currency', () => {
    expect(getProductPriceInCurrency(
      { final_price: 2, base_currency_id: USD },
      { convert, selectedCurrencyId: CUP }
    )).toBe(1540);
  });

  it('returns null when the price or the conversion cannot be resolved', () => {
    expect(getProductPriceInCurrency({ base_currency_id: USD }, { convert, selectedCurrencyId: USD })).toBeNull();
    expect(getProductPriceInCurrency(
      { final_price: 2, base_currency_id: 'unknown' },
      { convert, selectedCurrencyId: CUP }
    )).toBeNull();
  });
});

describe('getComboPriceInCurrency', () => {
  it('treats the stored combo price as base-currency and converts to the selected one', () => {
    expect(getComboPriceInCurrency(
      { finalPrice: 10 },
      { convert, baseCurrencyId: USD, selectedCurrencyId: CUP }
    )).toBe(7700);
  });

  it('does not convert when the selected currency is the base currency', () => {
    expect(getComboPriceInCurrency(
      { finalPrice: 10.456 },
      { convert, baseCurrencyId: USD, selectedCurrencyId: USD }
    )).toBe(10.46);
  });

  it('returns null when the combo has no usable price or the conversion fails', () => {
    expect(getComboPriceInCurrency({ finalPrice: 0 }, { convert, baseCurrencyId: USD, selectedCurrencyId: USD })).toBeNull();
    expect(getComboPriceInCurrency(
      { finalPrice: 10 },
      { convert: () => NaN, baseCurrencyId: USD, selectedCurrencyId: CUP }
    )).toBeNull();
  });
});
