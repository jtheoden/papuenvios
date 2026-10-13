import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { normalizePayerPhone, isValidPayerPhone, PAYER_PHONE_MAX_LENGTH } from '@/lib/payerPhone';

describe('payerPhone helper', () => {
  it('trims surrounding whitespace and tolerates non-strings', () => {
    expect(normalizePayerPhone('  +1 305 555 0100 ')).toBe('+1 305 555 0100');
    expect(normalizePayerPhone(undefined)).toBe('');
    expect(normalizePayerPhone(null)).toBe('');
  });

  it('accepts local and international formats without forcing a leading +', () => {
    expect(isValidPayerPhone('305 555 0100')).toBe(true);
    expect(isValidPayerPhone('+1 (305) 555-0100')).toBe(true);
    expect(isValidPayerPhone('13055550100')).toBe(true);
  });

  it('rejects empty, too short and letter-only values', () => {
    expect(isValidPayerPhone('')).toBe(false);
    expect(isValidPayerPhone('   ')).toBe(false);
    expect(isValidPayerPhone('12345')).toBe(false);
    expect(isValidPayerPhone('call me')).toBe(false);
    expect(isValidPayerPhone(undefined)).toBe(false);
  });

  it('rejects values longer than the column limit', () => {
    expect(PAYER_PHONE_MAX_LENGTH).toBe(30);
    expect(isValidPayerPhone(`1111111111-${'-'.repeat(25)}1111`)).toBe(false);
  });
});
