import { describe, it, expect } from 'vitest';
import { localeFor, formatNumber, formatDateTime } from '@/lib/numberFormat';

describe('numberFormat', () => {
  it('maps the app language to a concrete locale', () => {
    expect(localeFor('es')).toBe('es-ES');
    expect(localeFor('en')).toBe('en-US');
    expect(localeFor(undefined)).toBe('en-US');
  });

  it('formats numbers with the language decimal separator', () => {
    expect(formatNumber(0.9338, 'es', { maximumFractionDigits: 6 })).toBe('0,9338');
    expect(formatNumber(0.9338, 'en', { maximumFractionDigits: 6 })).toBe('0.9338');
    expect(formatNumber(null, 'en')).toBe('');
  });

  it('formats dates in the requested locale and tolerates invalid input', () => {
    expect(formatDateTime('2026-10-15T10:00:00Z', 'en')).toMatch(/2026/);
    expect(formatDateTime('nope', 'en')).toBe('');
  });
});
