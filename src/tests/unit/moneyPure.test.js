import { describe, it, expect } from 'vitest';
import { roundMoney, sumMoney } from '@/lib/moneyPure';

describe('roundMoney', () => {
  it('rounds half-up at the cent for classic float traps', () => {
    expect(roundMoney(44.805)).toBe(44.81);
    expect(roundMoney(30.9 * 1.45)).toBe(44.81);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(8.345)).toBe(8.35);
  });

  it('rounds products of high quantities', () => {
    expect(roundMoney(0.5459 * 27)).toBe(14.74);
    expect(roundMoney(27 * 0.55)).toBe(14.85);
  });

  it('keeps already rounded values untouched', () => {
    expect(roundMoney(10)).toBe(10);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(123456.78)).toBe(123456.78);
  });

  it('rounds negatives symmetrically (half away from zero)', () => {
    expect(roundMoney(-44.805)).toBe(-44.81);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.001)).toBe(0);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
  });

  it('accepts numeric strings', () => {
    expect(roundMoney('44.805')).toBe(44.81);
  });

  it('returns 0 for NaN, undefined, null and non-numeric input', () => {
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(undefined)).toBe(0);
    expect(roundMoney(null)).toBe(0);
    expect(roundMoney('abc')).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });

  it('handles tiny values that stringify in exponent notation', () => {
    expect(roundMoney(1e-7)).toBe(0);
    expect(roundMoney(5e-3)).toBe(0.01);
  });
});

describe('sumMoney', () => {
  it('sums values and rounds the result to cents', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([44.81, 14.74, 1.01])).toBe(60.56);
  });

  it('returns 0 for empty or invalid input', () => {
    expect(sumMoney([])).toBe(0);
    expect(sumMoney(undefined)).toBe(0);
    expect(sumMoney([NaN, 1.5, undefined])).toBe(1.5);
  });
});
