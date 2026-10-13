import { describe, it, expect } from 'vitest';
import { resolveMargin, validateMarginPercent } from '@/lib/marginResolver';

describe('resolveMargin', () => {
  it('prefers the product margin over category and global', () => {
    expect(resolveMargin({ product: 12, category: 20, global: 40 })).toEqual({ value: 12, source: 'product' });
  });

  it('falls back to the category margin when the product has none', () => {
    expect(resolveMargin({ product: null, category: 20, global: 40 })).toEqual({ value: 20, source: 'category' });
  });

  it('falls back to the global margin when product and category have none', () => {
    expect(resolveMargin({ product: undefined, category: null, global: 40 })).toEqual({ value: 40, source: 'global' });
  });

  it('keeps zero as a valid explicit margin', () => {
    expect(resolveMargin({ product: 0, category: 20, global: 40 })).toEqual({ value: 0, source: 'product' });
  });

  it('ignores NaN, empty strings and non-numeric values', () => {
    expect(resolveMargin({ product: NaN, category: '', global: 40 })).toEqual({ value: 40, source: 'global' });
    expect(resolveMargin({ product: 'abc', category: Infinity, global: 35 })).toEqual({ value: 35, source: 'global' });
  });

  it('accepts numeric strings', () => {
    expect(resolveMargin({ product: '12.5', category: null, global: 40 })).toEqual({ value: 12.5, source: 'product' });
  });

  it('returns null when nothing is usable', () => {
    expect(resolveMargin({})).toBeNull();
    expect(resolveMargin()).toBeNull();
  });
});

describe('validateMarginPercent', () => {
  it('accepts values within 0..999.99', () => {
    expect(validateMarginPercent(0)).toBe(true);
    expect(validateMarginPercent(40)).toBe(true);
    expect(validateMarginPercent(999.99)).toBe(true);
    expect(validateMarginPercent('35')).toBe(true);
  });

  it('rejects out of range, non-finite and non-numeric values', () => {
    expect(validateMarginPercent(-0.01)).toBe(false);
    expect(validateMarginPercent(1000)).toBe(false);
    expect(validateMarginPercent(NaN)).toBe(false);
    expect(validateMarginPercent(Infinity)).toBe(false);
    expect(validateMarginPercent('')).toBe(false);
    expect(validateMarginPercent(null)).toBe(false);
    expect(validateMarginPercent(undefined)).toBe(false);
    expect(validateMarginPercent('abc')).toBe(false);
  });
});
