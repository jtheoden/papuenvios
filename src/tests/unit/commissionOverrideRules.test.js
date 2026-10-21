import { describe, it, expect } from 'vitest';
import {
  REASON_MIN_LENGTH,
  REASON_MAX_LENGTH,
  canAdjustCommission,
  validateCommissionOverride,
  calcCommissionOverride,
} from '@/lib/commissionOverrideRules';

const REASON = 'Cliente frecuente, acuerdo comercial';

describe('canAdjustCommission', () => {
  it.each(['payment_pending', 'payment_rejected'])('is true for %s', (status) => {
    expect(canAdjustCommission({ status })).toBe(true);
  });

  it.each(['payment_proof_uploaded', 'payment_validated', 'processing', 'delivered', 'completed', 'cancelled', undefined])(
    'is false for %s',
    (status) => {
      expect(canAdjustCommission({ status })).toBe(false);
    }
  );

  it('is false without a remittance', () => {
    expect(canAdjustCommission(null)).toBe(false);
  });
});

describe('validateCommissionOverride', () => {
  it('accepts 0, a value below the amount sent and a trimmed reason of 10..500 characters', () => {
    expect(validateCommissionOverride({ commission: 0, reason: REASON, amountSent: 100 })).toEqual({});
    expect(validateCommissionOverride({ commission: 99.99, reason: REASON, amountSent: 100 })).toEqual({});
    expect(validateCommissionOverride({ commission: '5', reason: 'x'.repeat(REASON_MAX_LENGTH) })).toEqual({});
    expect(validateCommissionOverride({ commission: 1, reason: 'x'.repeat(REASON_MIN_LENGTH) })).toEqual({});
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['whitespace', '            '],
    ['too short', 'too short'],
    ['too long', 'x'.repeat(REASON_MAX_LENGTH + 1)],
  ])('rejects a reason that is %s', (_label, reason) => {
    expect(validateCommissionOverride({ commission: 1, reason, amountSent: 100 })).toHaveProperty('reason');
  });

  it.each([
    ['negative', -0.01],
    ['not a number', 'abc'],
    ['empty', ''],
    ['null', null],
    ['infinite', Infinity],
  ])('rejects a commission that is %s', (_label, commission) => {
    expect(validateCommissionOverride({ commission, reason: REASON, amountSent: 100 })).toHaveProperty('commission');
  });

  it('rejects a commission equal to or above the amount sent (when known)', () => {
    expect(validateCommissionOverride({ commission: 100, reason: REASON, amountSent: 100 })).toHaveProperty('commission');
    expect(validateCommissionOverride({ commission: 150, reason: REASON, amountSent: 100 })).toHaveProperty('commission');
    expect(validateCommissionOverride({ commission: 150, reason: REASON })).toEqual({});
  });

  it('rejects more than 2 decimals instead of silently rounding what the admin typed', () => {
    expect(validateCommissionOverride({ commission: 1.005, reason: REASON, amountSent: 100 })).toHaveProperty('commission');
    expect(validateCommissionOverride({ commission: 1.5, reason: REASON, amountSent: 100 })).toEqual({});
  });
});

describe('calcCommissionOverride', () => {
  it('delivers (sent - commission) * rate at cent precision and exposes the difference against the standard', () => {
    const r = calcCommissionOverride({ amountSent: 100, exchangeRate: 800, commission: 5, standardCommission: 2.5 });
    expect(r).toEqual({ commission: 5, amountToDeliver: 76000, difference: 2.5 });
  });

  it('a lower commission gives a negative difference and more delivery', () => {
    const r = calcCommissionOverride({ amountSent: 100, exchangeRate: 800, commission: 1, standardCommission: 2.5 });
    expect(r).toEqual({ commission: 1, amountToDeliver: 79200, difference: -1.5 });
  });

  it('matches the stored invariant for a rate with 4 decimals (REM-2026-001125 numbers)', () => {
    const r = calcCommissionOverride({ amountSent: 765, exchangeRate: 800.1234, commission: 19.13, standardCommission: 19.13 });
    expect(r.amountToDeliver).toBe(Math.round((765 - 19.13) * 800.1234 * 100) / 100);
    expect(r.difference).toBe(0);
  });
});
