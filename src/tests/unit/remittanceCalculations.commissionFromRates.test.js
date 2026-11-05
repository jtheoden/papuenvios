/**
 * A9 - the admin types the market rate and the delivery rate; the commission percentage is derived and stored in
 * numeric(5,2). The derived value must already be rounded to that scale, so the simulator and the stored rate agree.
 */
import { describe, it, expect } from 'vitest';
import { calcCommissionFromRates, effectiveDeliveryRate, simulateRemittance } from '@/lib/remittanceCalculations';

describe('calcCommissionFromRates', () => {
  it('rounds to the 2 decimals the column stores (520 market, 500 delivery -> 3.85, not 3.846153...)', () => {
    expect(calcCommissionFromRates(520, 500)).toBe(3.85);
  });

  it('keeps exact values', () => {
    expect(calcCommissionFromRates(915, 900)).toBe(1.64);
    expect(calcCommissionFromRates(800, 780)).toBe(2.5);
  });

  it('is 0 when the delivery rate is not below the market rate', () => {
    expect(calcCommissionFromRates(900, 900)).toBe(0);
    expect(calcCommissionFromRates(900, 950)).toBe(0);
  });

  it('keeps the previous edge cases', () => {
    expect(calcCommissionFromRates(0, 500)).toBe(0);
    expect(calcCommissionFromRates(-1, 500)).toBe(0);
    expect(calcCommissionFromRates(520, 0)).toBe(100);
    expect(calcCommissionFromRates(520, NaN)).toBe(100);
  });
});

describe('effectiveDeliveryRate', () => {
  it('is the rate the customer really gets with the stored (rounded) percentage', () => {
    expect(effectiveDeliveryRate(520, 3.85)).toBe(499.98);
  });

  it('equals the typed delivery rate when the percentage is exact', () => {
    expect(effectiveDeliveryRate(800, 2.5)).toBe(780);
  });
});

describe('the rounded percentage is what the simulator and the stored type use', () => {
  it('100 USD at market 520 / delivery 500 delivers the amount of the rounded 3.85% commission', () => {
    const pct = calcCommissionFromRates(520, 500);
    const sim = simulateRemittance({ mode: 'send', amount: 100, exchangeRate: 520, commissionPercentage: pct, commissionFixed: 0 });
    expect(sim.totalCommission).toBe(3.85);
    expect(sim.amountToDeliver).toBe(49998);
  });
});
