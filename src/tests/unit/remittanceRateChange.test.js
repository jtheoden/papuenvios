/**
 * A7 - the "rate changed" alert only compares the locked rate with the current one. It deliberately does NOT
 * promise a new amount: recalculate_remittance_at_current_rate may apply an admin commission override and a
 * percentage offer that the owner cannot read (RLS), so any client-side figure could differ from what the RPC delivers
 * (a real remittance with an override would show 274.50 CUP more than it gets). The amounts are covered by the
 * calcForward golden vectors (remittanceCalculations.test.js); a read-only SQL quote function is a Phase 3/F4 follow-up.
 */
import { describe, it, expect } from 'vitest';
import { quoteRateChange } from '@/lib/remittanceRateChange';

const remittance = (over = {}, typeOver = {}) => ({
  amount_sent: 100,
  exchange_rate: 900,
  discount_amount: 0,
  offer_id: null,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  remittance_types: { exchange_rate: 915, commission_percentage: 3, commission_fixed: 0, currency_code: 'USD', delivery_currency: 'CUP', ...typeOver },
  ...over
});

describe('quoteRateChange', () => {
  it('reports the direction and the percentage change as a number with two decimals', () => {
    const q = quoteRateChange(remittance({ exchange_rate: 900 }, { exchange_rate: 915 }));
    expect(q.snapshotRate).toBe(900);
    expect(q.currentRate).toBe(915);
    expect(q.rateUp).toBe(true);
    expect(q.pctChange).toBe(1.67);
    expect(quoteRateChange(remittance({ exchange_rate: 915 }, { exchange_rate: 900 })).rateUp).toBe(false);
  });

  it('keeps the rates at their real precision', () => {
    const q = quoteRateChange(remittance({ exchange_rate: 900.1234 }, { exchange_rate: 915.5678 }));
    expect(q.snapshotRate).toBe(900.1234);
    expect(q.currentRate).toBe(915.5678);
    expect(q.pctChange).toBe(1.72);
  });

  it('promises no amounts, with or without an offer or an admin commission override (documented follow-up)', () => {
    const plain = quoteRateChange(remittance());
    const withPercentageOffer = quoteRateChange(remittance({ offer_id: 'o1', discount_amount: 1 }));
    const withOverride = quoteRateChange(remittance({ commission_override: 12.5 }, { commission_percentage: 3 }));
    [plain, withPercentageOffer, withOverride].forEach((q) => {
      expect(q).not.toHaveProperty('newAmountToDeliver');
      expect(q).not.toHaveProperty('newCommission');
      expect(Object.keys(q).sort()).toEqual(['currentRate', 'pctChange', 'rateUp', 'snapshotRate']);
    });
  });

  it.each([
    ['remittance currencies', { currency_sent: 'USD', currency_delivered: 'USD' }, { exchange_rate: 105 }],
    ['type currencies when the remittance has none', { currency_sent: undefined, currency_delivered: undefined }, { exchange_rate: 105, delivery_currency: 'USD' }]
  ])('returns null for a same-currency remittance (USD to USD uses rate 1 in SQL), by %s', (_name, over, typeOver) => {
    expect(quoteRateChange(remittance({ exchange_rate: 1, ...over }, typeOver))).toBeNull();
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
