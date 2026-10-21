import { describe, it, expect } from 'vitest';
import { calcForward, calcReverse } from '@/lib/remittanceCalculations';
import { roundMoney, roundTo } from '@/lib/moneyPure';
import golden from '../fixtures/remittanceGoldenVectors.json';

// Scenario: USD → CUP, rate=24, commission=5%, fixed=$2
const BASE = { exchangeRate: 24, commissionPct: 5, commissionFixed: 2 };

const toForwardParams = ({ amount, rate, pct, fixed, offer }) => ({
  amount,
  exchangeRate: rate,
  commissionPct: pct,
  commissionFixed: fixed,
  offer,
});

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
    const result = calcForward({ amount: 100, ...BASE, offer });
    expect(result.discountAmount).toBe(7);
    expect(result.effectiveCommission).toBe(0);
    expect(result.amountToDeliver).toBe(2400);
  });

  it('effective commission cannot be negative (even for a percentage discount above 100)', () => {
    const offer = { discount_type: 'percentage', discount_value: 250 };
    const result = calcForward({ amount: 100, ...BASE, offer });
    expect(result.effectiveCommission).toBe(0);
    expect(result.discountAmount).toBeLessThanOrEqual(result.totalCommission);
  });

  it('ignores an unknown discount type', () => {
    const result = calcForward({ amount: 100, ...BASE, offer: { discount_type: 'bogus', discount_value: 10 } });
    expect(result.discountAmount).toBe(0);
    expect(result.effectiveCommission).toBe(7);
  });
});

describe('calcForward golden vectors (shared with the SQL tests)', () => {
  it.each(golden.forward.map((v) => [v.name, v]))('%s', (_name, v) => {
    const r = calcForward(toForwardParams(v.input));
    expect(r.amountSent).toBe(v.expected.amountSent);
    expect(r.totalCommission).toBe(v.expected.gross);
    expect(r.discountAmount).toBe(v.expected.discount);
    expect(r.effectiveCommission).toBe(v.expected.commission);
    expect(r.amountToDeliver).toBe(v.expected.amountToDeliver);
  });

  it('stored invariant: amount_to_deliver = round((amount_sent - commission) * exchange_rate, 2)', () => {
    golden.forward.forEach((v) => {
      const r = calcForward(toForwardParams(v.input));
      expect(r.amountToDeliver, v.name).toBe(roundMoney((r.amountSent - r.effectiveCommission) * r.exchangeRate));
    });
  });

  it('exposes the rate at the scale it is stored (4 decimals)', () => {
    expect(calcForward({ amount: 100, exchangeRate: 790.12345, commissionPct: 0, commissionFixed: 0 }).exchangeRate)
      .toBe(roundTo(790.12345, 4));
  });

  it('never uses float-sensitive rounding on money: every output has at most 2 decimals', () => {
    golden.forward.forEach((v) => {
      const r = calcForward(toForwardParams(v.input));
      [r.amountSent, r.totalCommission, r.discountAmount, r.effectiveCommission, r.amountToDeliver].forEach((n) => {
        expect(roundMoney(n), v.name).toBe(n);
      });
    });
  });
});

// ─── calcReverse ─────────────────────────────────────────────────────────────

describe('calcReverse', () => {
  it('calculates amount to send for desired receive amount', () => {
    // desired=2232, solve: send = ((2232/24)+2)/(1-0.05) = (93+2)/0.95 = 100
    expect(calcReverse({ desiredReceive: 2232, ...BASE })).toBe(100);
  });

  it('throws when commission is 100%', () => {
    expect(() => calcReverse({ desiredReceive: 100, exchangeRate: 1, commissionPct: 100, commissionFixed: 0 }))
      .toThrow('Commission percentage cannot be 100% or more');
  });

  it('no commission returns desired/rate, at cent precision', () => {
    expect(calcReverse({ desiredReceive: 2400, exchangeRate: 24, commissionPct: 0, commissionFixed: 0 })).toBe(100);
  });

  it.each([0, -1, NaN, undefined, 0.00004])('rejects an unusable exchange rate (%s) with a clear error, not a convergence error', (rate) => {
    expect(() => calcReverse({ desiredReceive: 100, exchangeRate: rate, commissionPct: 5, commissionFixed: 0 }))
      .toThrow(/exchange rate/i);
  });

  it.each([90, 95])('converges with a %s percent commission and the recipient gets at least the requested amount', (pct) => {
    for (const desiredReceive of [1, 33.33, 2232, 500000]) {
      for (const exchangeRate of [1, 24, 515.5555]) {
        const params = { exchangeRate, commissionPct: pct, commissionFixed: 1.5 };
        const send = calcReverse({ desiredReceive, ...params });
        expect(calcForward({ amount: send, ...params }).amountToDeliver, JSON.stringify({ desiredReceive, ...params })).toBeGreaterThanOrEqual(desiredReceive);
      }
    }
  });

  it('a negative offer value never raises the commission above the gross one (symmetry with SQL greatest(0, ...))', () => {
    const fwd = calcForward({ amount: 100, exchangeRate: 1, commissionPct: 5, commissionFixed: 0, offer: { discount_type: 'fixed_amount', discount_value: -3 } });
    expect([fwd.discountAmount, fwd.effectiveCommission]).toEqual([0, 5]);
  });

  it.each(golden.reverse.map((v) => [v.name, v]))('golden vector: %s', (_name, v) => {
    const send = calcReverse({ desiredReceive: v.input.desired, exchangeRate: v.input.rate, commissionPct: v.input.pct, commissionFixed: v.input.fixed });
    expect(send).toBe(v.expected.amountToSend);
    const fwd = calcForward({ amount: send, exchangeRate: v.input.rate, commissionPct: v.input.pct, commissionFixed: v.input.fixed });
    expect(fwd.amountToDeliver).toBe(v.expected.amountToDeliver);
    expect(fwd.effectiveCommission).toBe(v.expected.commission);
    expect(fwd.amountToDeliver).toBeGreaterThanOrEqual(v.input.desired);
  });
});

// ─── property: the recipient never gets less than requested ─────────────────

describe('property: forward(reverse(D)).amountToDeliver >= D', () => {
  // mulberry32: deterministic, so a failure is reproducible
  const prng = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('holds on 3000 seeded random combinations and never overshoots by more than a few cents of USD', () => {
    const rnd = prng(20261021);
    for (let i = 0; i < 3000; i += 1) {
      const desiredReceive = roundMoney(1 + rnd() * 999999);
      const exchangeRate = roundTo(1 + rnd() * 999, 4);
      const commissionPct = roundMoney(rnd() * 20);
      const commissionFixed = roundMoney(rnd() * 5);
      const params = { desiredReceive, exchangeRate, commissionPct, commissionFixed };
      const send = calcReverse(params);
      const fwd = calcForward({ amount: send, exchangeRate, commissionPct, commissionFixed });
      const ctx = JSON.stringify(params);
      expect(fwd.amountToDeliver, ctx).toBeGreaterThanOrEqual(desiredReceive);
      expect(fwd.amountToDeliver - desiredReceive, ctx).toBeLessThanOrEqual(0.05 * exchangeRate + 0.01);
    }
  });
});
