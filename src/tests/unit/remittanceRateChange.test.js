/**
 * A7 - the "rate changed" alert must promise what recalculate_remittance_at_current_rate will apply:
 * same rounding contract (calcForward), same golden vectors as the SQL twin, with and without an offer.
 */
import { describe, it, expect } from 'vitest';
import golden from '../fixtures/remittanceGoldenVectors.json';
import { quoteRateChange } from '@/lib/remittanceRateChange';

const remittance = (over = {}, typeOver = {}) => ({
  amount_sent: 100,
  exchange_rate: 900,
  discount_amount: 0,
  offer_id: null,
  remittance_types: { exchange_rate: 915, commission_percentage: 3, commission_fixed: 0, ...typeOver },
  ...over
});

describe('quoteRateChange against the golden vectors', () => {
  // The vectors without an offer: the type's own rate is the "current" rate.
  it.each(golden.forward.filter((v) => !v.input.offer && v.input.rate > 0).map((v) => [v.name, v]))(
    'no offer: %s',
    (_name, v) => {
      const q = quoteRateChange(
        remittance(
          { amount_sent: v.input.amount, exchange_rate: v.input.rate / 2 },
          { exchange_rate: v.input.rate, commission_percentage: v.input.pct, commission_fixed: v.input.fixed }
        )
      );
      expect(q.newAmountToDeliver).toBe(v.expected.amountToDeliver);
      expect(q.newCommission).toBe(v.expected.commission);
    }
  );

  // With an offer the stored discount_amount is what the offer produced at creation (the offer row is not loaded here).
  it.each(golden.forward.filter((v) => v.input.offer && v.input.rate > 0).map((v) => [v.name, v]))(
    'with an offer: %s',
    (_name, v) => {
      const q = quoteRateChange(
        remittance(
          { amount_sent: v.input.amount, exchange_rate: v.input.rate / 2, offer_id: 'offer-1', discount_amount: v.expected.discount },
          { exchange_rate: v.input.rate, commission_percentage: v.input.pct, commission_fixed: v.input.fixed }
        )
      );
      expect(q.newAmountToDeliver).toBe(v.expected.amountToDeliver);
      expect(q.newCommission).toBe(v.expected.commission);
    }
  );

  it('the vector set really exercises both cases', () => {
    expect(golden.forward.some((v) => v.input.offer)).toBe(true);
    expect(golden.forward.some((v) => !v.input.offer)).toBe(true);
  });
});

describe('quoteRateChange details', () => {
  it('rounds with the contract, not with raw float arithmetic (old formula gave 91.0.. artefacts)', () => {
    const q = quoteRateChange(remittance({ amount_sent: 765, exchange_rate: 800 }, { exchange_rate: 805.5, commission_percentage: 2.5 }));
    expect(q.newCommission).toBe(19.13);
    // (765 - 19.13) * 805.5 = 600798.285 exactly: half-up gives .29 (float Math.round would give .28)
    expect(q.newAmountToDeliver).toBe(600798.29);
  });

  it('applies the stored discount to the commission (the old alert ignored offers)', () => {
    const withDiscount = quoteRateChange(remittance({ offer_id: 'o1', discount_amount: 1 }));
    const without = quoteRateChange(remittance());
    expect(withDiscount.newCommission).toBe(2);
    expect(without.newCommission).toBe(3);
    expect(withDiscount.newAmountToDeliver).toBeGreaterThan(without.newAmountToDeliver);
  });

  it('reports the direction and the percentage change as a number with two decimals', () => {
    const q = quoteRateChange(remittance({ exchange_rate: 900 }, { exchange_rate: 915 }));
    expect(q.snapshotRate).toBe(900);
    expect(q.currentRate).toBe(915);
    expect(q.rateUp).toBe(true);
    expect(q.pctChange).toBe(1.67);
    expect(quoteRateChange(remittance({ exchange_rate: 915 }, { exchange_rate: 900 })).rateUp).toBe(false);
  });

  it.each([
    ['snapshot rate 0', { exchange_rate: 0 }, {}],
    ['snapshot rate null', { exchange_rate: null }, {}],
    ['current rate 0', {}, { exchange_rate: 0 }],
    ['current rate null', {}, { exchange_rate: null }]
  ])('returns null (no division by zero, no alert numbers) with %s', (_name, over, typeOver) => {
    expect(quoteRateChange(remittance(over, typeOver))).toBeNull();
  });

  it('returns null without a remittance type', () => {
    expect(quoteRateChange({ amount_sent: 100, exchange_rate: 900 })).toBeNull();
  });
});
