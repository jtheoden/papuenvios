import { describe, it, expect } from 'vitest';
import { evaluateComboPricing } from '@/lib/comboUtils';

const RATES = { 'eur>usd': 1.1, 'usd>eur': 1 / 1.1 };
const convert = (amount, from, to) => (from === to ? amount : amount * RATES[`${from}>${to}`]);

const catalog = [
  { id: 'a', base_price: 40, final_price: 56, base_currency_id: 'usd' },
  { id: 'b', base_price: 36.44, final_price: 50.75, base_currency_id: 'usd' },
  { id: 'eur1', base_price: 10, final_price: 14, base_currency_id: 'eur' },
  { id: 'nofinal', base_price: 10, profit_margin: 20, base_currency_id: 'usd' }
];

const evaluate = (combo, extra = {}) =>
  evaluateComboPricing({
    combo,
    products: catalog,
    convert,
    baseCurrencyId: 'usd',
    defaultProfitMargin: 45,
    ...extra
  });

describe('evaluateComboPricing', () => {
  it('flags a combo more expensive than its products (real production-like numbers)', () => {
    const r = evaluate({ products: ['a', 'b'], productQuantities: { a: 1, b: 1 }, profitMargin: 45 });
    expect(r.comboPrice).toBe(110.84);
    expect(r.individualTotal).toBe(106.75);
    expect(r.difference).toBe(-4.09);
    expect(r.isMoreExpensive).toBe(true);
    expect(r.maxMarginWithoutLoss).toBe(39.65);
    expect(r.savingsPercent).toBeLessThan(0);
  });

  it('does not flag a cheaper combo and reports positive savings', () => {
    const r = evaluate({ products: ['a', 'b'], productQuantities: { a: 1, b: 1 }, profitMargin: 20 });
    expect(r.comboPrice).toBe(91.73);
    expect(r.difference).toBe(15.02);
    expect(r.isMoreExpensive).toBe(false);
    expect(r.savingsPercent).toBeCloseTo(14.07, 1);
  });

  it('does not flag when the prices are equal within rounding tolerance', () => {
    // 76.44 * 1.3965 = 106.7485 -> 106.75 === individual total
    const r = evaluate({ products: ['a', 'b'], productQuantities: { a: 1, b: 1 }, profitMargin: 39.65 });
    expect(r.comboPrice).toBe(106.75);
    expect(r.isMoreExpensive).toBe(false);
  });

  it('the suggested max margin never produces a more expensive combo', () => {
    const base = evaluate({ products: ['a', 'b'], productQuantities: {}, profitMargin: 45 });
    const applied = evaluate({
      products: ['a', 'b'],
      productQuantities: {},
      profitMargin: base.maxMarginWithoutLoss
    });
    expect(applied.isMoreExpensive).toBe(false);
  });

  it('converts products in other currencies to the base currency', () => {
    // base: 40 + 10 EUR*1.1 = 51 ; individual: 56 + 14*1.1 = 71.4
    const over = evaluate({ products: ['a', 'eur1'], productQuantities: {}, profitMargin: 45 });
    expect(over.comboPrice).toBe(73.95);
    expect(over.individualTotal).toBe(71.4);
    expect(over.isMoreExpensive).toBe(true);
    expect(over.maxMarginWithoutLoss).toBe(40);
  });

  it('multiplies by quantity on both sides', () => {
    const r = evaluate({ products: ['a'], productQuantities: { a: 3 }, profitMargin: 45 });
    expect(r.comboPrice).toBe(174);
    expect(r.individualTotal).toBe(168);
    expect(r.isMoreExpensive).toBe(true);
    expect(r.maxMarginWithoutLoss).toBe(40);
  });

  it('falls back to base_price * (1 + margin) when final_price is absent', () => {
    const r = evaluate({ products: ['nofinal'], productQuantities: {}, profitMargin: 45 });
    expect(r.individualTotal).toBe(12);
    expect(r.comboPrice).toBe(14.5);
    expect(r.isMoreExpensive).toBe(true);
    expect(r.maxMarginWithoutLoss).toBe(20);
  });

  it('returns a neutral result for an empty combo', () => {
    const r = evaluate({ products: [], productQuantities: {}, profitMargin: 45 });
    expect(r).toEqual({
      comboPrice: 0,
      individualTotal: 0,
      difference: 0,
      savingsPercent: 0,
      isMoreExpensive: false,
      maxMarginWithoutLoss: 0
    });
  });

  it('returns a neutral result when the combo is missing', () => {
    expect(evaluate(undefined).isMoreExpensive).toBe(false);
  });

  it('ignores products missing from the catalog and does not warn when none are found', () => {
    const none = evaluate({ products: ['ghost'], productQuantities: {}, profitMargin: 45 });
    expect(none.isMoreExpensive).toBe(false);
    expect(none.individualTotal).toBe(0);

    const partial = evaluate({ products: ['a', 'ghost'], productQuantities: {}, profitMargin: 45 });
    expect(partial.comboPrice).toBe(58);
    expect(partial.individualTotal).toBe(56);
    expect(partial.isMoreExpensive).toBe(true);
  });

  it('accepts DB-shaped combos (profit_margin) and the default margin when absent', () => {
    const db = evaluate({ products: ['a'], productQuantities: {}, profit_margin: 10 });
    expect(db.comboPrice).toBe(44);
    expect(db.isMoreExpensive).toBe(false);

    const dflt = evaluate({ products: ['a'], productQuantities: {} });
    expect(dflt.comboPrice).toBe(58);
    expect(dflt.isMoreExpensive).toBe(true);
  });

  it('never suggests a negative max margin', () => {
    const cheap = [{ id: 'neg', base_price: 10, final_price: 8, base_currency_id: 'usd' }];
    const r = evaluateComboPricing({
      combo: { products: ['neg'], productQuantities: {}, profitMargin: 5 },
      products: cheap,
      convert,
      baseCurrencyId: 'usd'
    });
    expect(r.isMoreExpensive).toBe(true);
    expect(r.maxMarginWithoutLoss).toBe(0);
  });

  it('expresses prices in the selected currency when provided', () => {
    const r = evaluate(
      { products: ['a'], productQuantities: {}, profitMargin: 45 },
      { selectedCurrencyId: 'eur' }
    );
    expect(r.comboPrice).toBeCloseTo(58 / 1.1, 1);
    expect(r.individualTotal).toBeCloseTo(56 / 1.1, 1);
    expect(r.maxMarginWithoutLoss).toBeCloseTo(40, 1);
  });
});
