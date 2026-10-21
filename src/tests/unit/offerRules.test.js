import { describe, it, expect } from 'vitest';
import { normalizeDiscountType, isOfferInWindow } from '../../lib/offerRules';
import { calcForward } from '../../lib/remittanceCalculations';
import { applyOffer } from '../../lib/priceCalculationService';

describe('normalizeDiscountType', () => {
  it('maps legacy "fixed" to the schema value "fixed_amount"', () => {
    expect(normalizeDiscountType('fixed')).toBe('fixed_amount');
  });
  it('keeps valid schema values', () => {
    expect(normalizeDiscountType('fixed_amount')).toBe('fixed_amount');
    expect(normalizeDiscountType('percentage')).toBe('percentage');
  });
  it('returns null for unknown or empty values', () => {
    expect(normalizeDiscountType('bogus')).toBeNull();
    expect(normalizeDiscountType(null)).toBeNull();
    expect(normalizeDiscountType(undefined)).toBeNull();
  });
});

describe('isOfferInWindow', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const offer = { start_date: '2026-06-01T00:00:00Z', end_date: '2026-06-30T00:00:00Z' };
  it('is false before start_date', () => {
    expect(isOfferInWindow({ ...offer, start_date: '2026-06-16T00:00:00Z' }, now)).toBe(false);
  });
  it('is true during the window', () => {
    expect(isOfferInWindow(offer, now)).toBe(true);
  });
  it('is false after end_date', () => {
    expect(isOfferInWindow({ ...offer, end_date: '2026-06-14T00:00:00Z' }, now)).toBe(false);
  });
  it('includes both boundaries', () => {
    expect(isOfferInWindow({ start_date: now.toISOString(), end_date: now.toISOString() }, now)).toBe(true);
  });
  it('treats null/missing bounds as open-ended', () => {
    expect(isOfferInWindow({ start_date: null, end_date: null }, now)).toBe(true);
    expect(isOfferInWindow({}, now)).toBe(true);
    expect(isOfferInWindow({ start_date: null, end_date: '2026-06-14T00:00:00Z' }, now)).toBe(false);
    expect(isOfferInWindow({ start_date: '2026-06-16T00:00:00Z', end_date: null }, now)).toBe(false);
  });
  it('ignores the nonexistent valid_until field', () => {
    expect(isOfferInWindow({ valid_until: '2020-01-01T00:00:00Z' }, now)).toBe(true);
  });
  it('is false for a missing offer', () => {
    expect(isOfferInWindow(null, now)).toBe(false);
  });
});

describe('fixed discount is applied for both spellings', () => {
  const base = { amount: 100, exchangeRate: 1, commissionPct: 10, commissionFixed: 0 };
  it.each(['fixed', 'fixed_amount'])('remittance commission discount with %s', (t) => {
    const r = calcForward({ ...base, offer: { discount_type: t, discount_value: 4 } });
    expect(r.discountAmount).toBe(4);
  });
  it.each(['fixed', 'fixed_amount'])('order offer discount with %s', (t) => {
    const r = applyOffer(100, { id: 1, discount_type: t, discount_value: 15 });
    expect(r.discountAmount).toBe(15);
  });
});
