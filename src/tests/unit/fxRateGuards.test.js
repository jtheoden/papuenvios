import { describe, it, expect } from 'vitest';
import {
  isUsdEurPair,
  selectableRateCurrencies,
  isRatePairAllowed,
  validateUsdEurRate,
  rateChangeRatio,
  requiresChangeConfirmation,
  FX_RATE_CONFIRM_CHANGE_RATIO
} from '@/lib/fxRateGuards';

describe('isUsdEurPair', () => {
  it('matches only the direct USD->EUR direction', () => {
    expect(isUsdEurPair('USD', 'EUR')).toBe(true);
    expect(isUsdEurPair('usd', 'eur')).toBe(true);
    expect(isUsdEurPair('EUR', 'USD')).toBe(false);
    expect(isUsdEurPair('USD', 'CUP')).toBe(false);
    expect(isUsdEurPair(undefined, 'EUR')).toBe(false);
  });
});

describe('inactive EUR is selectable only as the target of a USD rate', () => {
  const usd = { id: 'usd', code: 'USD', is_active: true };
  const cup = { id: 'cup', code: 'CUP', is_active: true };
  const eur = { id: 'eur', code: 'EUR', is_active: false };
  const gbp = { id: 'gbp', code: 'GBP', is_active: false };
  const all = [usd, cup, eur, gbp];

  it('offers inactive EUR in the "to" selector only when "from" is USD', () => {
    expect(selectableRateCurrencies(all, { role: 'to', otherId: 'usd' }).map((c) => c.code)).toEqual(['CUP', 'EUR']);
    expect(selectableRateCurrencies(all, { role: 'to', otherId: 'cup' }).map((c) => c.code)).toEqual(['USD']);
    expect(selectableRateCurrencies(all, { role: 'to', otherId: '' }).map((c) => c.code)).toEqual(['USD', 'CUP']);
  });

  it('never offers inactive EUR in the "from" selector, nor any other inactive currency', () => {
    expect(selectableRateCurrencies(all, { role: 'from', otherId: 'usd' }).map((c) => c.code)).toEqual(['CUP']);
    expect(selectableRateCurrencies(all, { role: 'from', otherId: 'eur' }).map((c) => c.code)).toEqual(['USD', 'CUP']);
  });

  it('keeps an active EUR selectable like any other active currency', () => {
    const activeEur = { ...eur, is_active: true };
    expect(selectableRateCurrencies([usd, activeEur], { role: 'from', otherId: '' }).map((c) => c.code)).toEqual(['USD', 'EUR']);
  });

  it('validates a pair: both active, or USD -> inactive EUR', () => {
    expect(isRatePairAllowed(usd, cup)).toBe(true);
    expect(isRatePairAllowed(usd, eur)).toBe(true);
    expect(isRatePairAllowed(eur, usd)).toBe(false);
    expect(isRatePairAllowed(cup, eur)).toBe(false);
    expect(isRatePairAllowed(usd, gbp)).toBe(false);
    expect(isRatePairAllowed(undefined, usd)).toBe(false);
  });
});

describe('validateUsdEurRate', () => {
  it.each([['0.92'], [0.92], ['0.5'], [1.5]])('accepts %s', (value) => {
    expect(validateUsdEurRate(value)).toEqual({ ok: true });
  });

  it.each([[92], ['92'], [0.49], [1.51], [0], [-1], ['abc'], [''], [NaN], [null], [undefined]])(
    'rejects %s as out of range',
    (value) => {
      expect(validateUsdEurRate(value)).toEqual({ ok: false, code: 'out_of_band' });
    }
  );
});

describe('rateChangeRatio / requiresChangeConfirmation', () => {
  it('uses a 5% threshold by default', () => {
    expect(FX_RATE_CONFIRM_CHANGE_RATIO).toBe(0.05);
  });

  it('computes the relative change against the previous rate', () => {
    expect(rateChangeRatio(0.92, 0.966)).toBeCloseTo(0.05, 5);
    expect(rateChangeRatio('0.92', '0.92')).toBe(0);
  });

  it('returns null when there is no comparable previous rate', () => {
    expect(rateChangeRatio(null, 0.9)).toBeNull();
    expect(rateChangeRatio(0, 0.9)).toBeNull();
    expect(rateChangeRatio('x', 0.9)).toBeNull();
  });

  it('asks for confirmation only when the change is strictly larger than the threshold', () => {
    expect(requiresChangeConfirmation(0.92, 0.92 * 1.05)).toBe(false);
    expect(requiresChangeConfirmation(0.92, 0.92 * 1.0501)).toBe(true);
    expect(requiresChangeConfirmation(0.92, 0.92 * 0.94)).toBe(true);
    expect(requiresChangeConfirmation(0.92, 0.93)).toBe(false);
  });

  it('does not ask when there is no previous rate (first load)', () => {
    expect(requiresChangeConfirmation(null, 0.9)).toBe(false);
  });
});
