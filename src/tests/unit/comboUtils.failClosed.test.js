/**
 * A6 - combo admin conversions fail closed: without a rate the result is NaN ("unavailable"),
 * never the unconverted amount presented as if it were in the target currency.
 */
import { describe, it, expect } from 'vitest';
import { convertWithRates, computeComboPricing } from '@/lib/comboUtils';

const RATES = { 'usd-cup': 770 };

describe('convertWithRates (id-keyed rates map, as loaded by the vendor page)', () => {
  it('returns the amount when both ids are equal', () => {
    expect(convertWithRates(10, 'usd', 'usd', RATES)).toBe(10);
  });

  it('uses the direct rate', () => {
    expect(convertWithRates(10, 'usd', 'cup', RATES)).toBe(7700);
  });

  it('uses the inverse of the opposite rate when there is no direct one', () => {
    expect(convertWithRates(7700, 'cup', 'usd', RATES)).toBe(10);
  });

  it('is NaN when there is no rate for the pair (not the raw amount)', () => {
    expect(convertWithRates(10, 'usd', 'eur', RATES)).toBeNaN();
    expect(convertWithRates(10, 'usd', 'cup', {})).toBeNaN();
    expect(convertWithRates(10, 'usd', 'cup', undefined)).toBeNaN();
  });

  it('is NaN when an id is missing and the ids differ', () => {
    expect(convertWithRates(10, undefined, 'cup', RATES)).toBeNaN();
    expect(convertWithRates(10, 'usd', null, RATES)).toBeNaN();
  });

  it('keeps an empty amount as 0 and a NaN amount as NaN', () => {
    expect(convertWithRates(0, 'usd', 'cup', RATES)).toBe(0);
    expect(convertWithRates(NaN, 'usd', 'cup', RATES)).toBeNaN();
  });

  it('ignores non-positive rates', () => {
    expect(convertWithRates(10, 'usd', 'cup', { 'usd-cup': 0 })).toBeNaN();
    expect(convertWithRates(10, 'usd', 'cup', { 'cup-usd': -1 })).toBeNaN();
  });
});

describe('computeComboPricing with an unconvertible component', () => {
  const products = [
    { id: 'p1', base_price: 10, base_currency_id: 'usd' },
    { id: 'p2', base_price: 5000, base_currency_id: 'eur' }
  ];
  const combo = { products: ['p1', 'p2'], productQuantities: { p1: 1, p2: 1 }, profitMargin: 20, base_total_price: 99 };
  const convert = (amount, from, to) => convertWithRates(amount, from, to, RATES);

  it('does not fall back to the raw foreign price nor to the stored total: the preview is NaN', () => {
    const prices = computeComboPricing({ combo, products, convert, selectedCurrencyId: 'usd', baseCurrencyId: 'usd' });
    expect(prices.basePrice).toBeNaN();
    expect(prices.finalPrice).toBeNaN();
  });

  it('still prices a combo whose components are all convertible', () => {
    const ok = computeComboPricing({
      combo: { ...combo, products: ['p1'] },
      products,
      convert,
      selectedCurrencyId: 'usd',
      baseCurrencyId: 'usd'
    });
    expect(ok.basePrice).toBe(10);
    expect(ok.finalPrice).toBe(12);
  });

  it('converts the base total to the selected currency when a rate exists', () => {
    const ok = computeComboPricing({
      combo: { ...combo, products: ['p1'] },
      products,
      convert,
      selectedCurrencyId: 'cup',
      baseCurrencyId: 'usd'
    });
    expect(ok.basePrice).toBe(7700);
  });
});
