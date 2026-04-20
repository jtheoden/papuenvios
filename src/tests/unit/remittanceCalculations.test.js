import { describe, it, expect } from 'vitest';
import { calcForward, calcReverse, roundtrip } from '@/lib/remittanceCalculations';

// Scenario: USD → CUP, rate=24, commission=5%, fixed=$2
const BASE = { exchangeRate: 24, commissionPct: 5, commissionFixed: 2 };

// ─── calcForward ─────────────────────────────────────────────────────────────

describe('calcForward', () => {
  it('calculates delivery amount correctly', () => {
    // commission = 100*0.05 + 2 = 7, deliver = (100-7)*24 = 93*24 = 2232
    const result = calcForward({ amount: 100, ...BASE });
    expect(result.totalCommission).toBe(7);
    expect(result.effectiveCommission).toBe(7);
    expect(result.amountToDeliver).toBe(2232);
  });

  it('zero commission returns full amount * rate', () => {
    const result = calcForward({ amount: 100, exchangeRate: 24, commissionPct: 0, commissionFixed: 0 });
    expect(result.amountToDeliver).toBe(2400);
  });

  it('same currency rate=1 yields amount minus commission', () => {
    const result = calcForward({ amount: 100, exchangeRate: 1, commissionPct: 5, commissionFixed: 0 });
    expect(result.amountToDeliver).toBe(95);
  });

  it('applies percentage offer discount to commission', () => {
    const offer = { discount_type: 'percentage', discount_value: 50 };
    // commission=7, discount=3.5, effective=3.5, deliver=(100-3.5)*24=2316
    const result = calcForward({ amount: 100, ...BASE, offer });
    expect(result.discountAmount).toBe(3.5);
    expect(result.effectiveCommission).toBe(3.5);
    expect(result.amountToDeliver).toBe(2316);
  });

  it('applies fixed offer discount capped at commission', () => {
    const offer = { discount_type: 'fixed', discount_value: 100 };
    // discount capped at commission=7, effective=0
    const result = calcForward({ amount: 100, ...BASE, offer });
    expect(result.discountAmount).toBe(7);
    expect(result.effectiveCommission).toBe(0);
    expect(result.amountToDeliver).toBe(2400);
  });

  it('effective commission cannot be negative', () => {
    const offer = { discount_type: 'fixed', discount_value: 999 };
    const result = calcForward({ amount: 100, ...BASE, offer });
    expect(result.effectiveCommission).toBeGreaterThanOrEqual(0);
  });
});

// ─── calcReverse ─────────────────────────────────────────────────────────────

describe('calcReverse', () => {
  it('calculates amount to send for desired receive amount', () => {
    // desired=2232, solve: send = ((2232/24)+2)/(1-0.05) = (93+2)/0.95 = 95/0.95 = 100
    const send = calcReverse({ desiredReceive: 2232, ...BASE });
    expect(send).toBeCloseTo(100, 2);
  });

  it('throws when commission is 100%', () => {
    expect(() => calcReverse({ desiredReceive: 100, exchangeRate: 1, commissionPct: 100, commissionFixed: 0 }))
      .toThrow('Commission percentage cannot be 100% or more');
  });

  it('no commission returns desired/rate', () => {
    const send = calcReverse({ desiredReceive: 2400, exchangeRate: 24, commissionPct: 0, commissionFixed: 0 });
    expect(send).toBeCloseTo(100, 2);
  });
});

// ─── roundtrip invariant ─────────────────────────────────────────────────────

describe('roundtrip invariant: forward(reverse(desired)) ≈ desired', () => {
  const cases = [
    { desiredReceive: 2400, ...BASE },
    { desiredReceive: 1000, exchangeRate: 100, commissionPct: 3, commissionFixed: 0 },
    { desiredReceive: 500, exchangeRate: 1, commissionPct: 10, commissionFixed: 5 },
    { desiredReceive: 50000, exchangeRate: 200, commissionPct: 2, commissionFixed: 1 },
  ];

  cases.forEach(({ desiredReceive, ...params }) => {
    it(`delivers ≈${desiredReceive} when rate=${params.exchangeRate}, pct=${params.commissionPct}%, fixed=${params.commissionFixed}`, () => {
      const delivered = roundtrip({ desiredReceive, ...params });
      expect(delivered).toBeCloseTo(desiredReceive, 1);
    });
  });
});
