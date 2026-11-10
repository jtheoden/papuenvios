import { describe, it, expect } from 'vitest';
import { localeFor, formatNumber, formatDateTime, formatDateTimeUtc, formatMoney, formatRate, formatDateOnly } from '@/lib/numberFormat';

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

  it('formats a moment in UTC regardless of the machine time zone', () => {
    expect(formatDateTimeUtc('2026-10-16T00:00:01Z', 'en')).toBe('Oct 16, 2026, 12:00 AM');
    expect(formatDateTimeUtc('nope', 'en')).toBe('');
  });
});

// Intl uses a no-break space before the es currency symbol; compare with a plain space.
const plain = (text) => text.replace(/\u00a0/g, ' ');

describe('formatMoney', () => {
  it('formats 1234.5 USD with the language locale, always two decimals', () => {
    expect(plain(formatMoney(1234.5, { currency: 'USD', language: 'en' }))).toBe('$1,234.50');
    expect(plain(formatMoney(1234.5, { currency: 'USD', language: 'es' }))).toBe('1234,50 US$');
    expect(plain(formatMoney(12345.5, { currency: 'USD', language: 'es' }))).toBe('12.345,50 US$');
  });

  it('can show the ISO currency code instead of the symbol (currencyDisplay: code)', () => {
    expect(plain(formatMoney(26, { currency: 'USD', language: 'es', currencyDisplay: 'code' }))).toBe('26,00 USD');
    expect(plain(formatMoney(26, { currency: 'USD', language: 'en', currencyDisplay: 'code' }))).toBe('USD 26.00');
    expect(plain(formatMoney(7700, { currency: 'CUP', language: 'es', currencyDisplay: 'code' }))).toBe('7700,00 CUP');
  });

  it('defaults to USD and to the English locale', () => {
    expect(formatMoney(5)).toBe('$5.00');
  });

  it('formats zero and negatives', () => {
    expect(formatMoney(0, { currency: 'USD', language: 'en' })).toBe('$0.00');
    expect(formatMoney(-5, { currency: 'EUR', language: 'en' })).toBe('-€5.00');
  });

  it('accepts numeric strings', () => {
    expect(formatMoney('12.5', { currency: 'USD', language: 'en' })).toBe('$12.50');
  });

  it.each([NaN, null, undefined, '', 'abc', Infinity])('renders an em dash for unavailable value %s (never NaN or $0.00)', (value) => {
    expect(formatMoney(value, { currency: 'USD', language: 'en' })).toBe('\u2014');
  });

  it('rounds half-up through roundMoney where toFixed is wrong', () => {
    expect((1.005).toFixed(2)).toBe('1.00'); // the bug being avoided
    expect(formatMoney(1.005, { language: 'en' })).toBe('$1.01');
    expect((2.675).toFixed(2)).toBe('2.67');
    expect(formatMoney(2.675, { language: 'en' })).toBe('$2.68');
    expect((1.255).toFixed(2)).toBe('1.25');
    expect(formatMoney(1.255, { language: 'en' })).toBe('$1.26');
  });

  it('never shows negative zero', () => {
    expect(formatMoney(-0.001, { language: 'en' })).toBe('$0.00');
  });

  it('falls back to "amount CODE" for a code Intl rejects', () => {
    expect(formatMoney(5, { currency: '$$', language: 'en' })).toBe('5.00 $$');
  });
});

describe('formatRate', () => {
  it('keeps up to six decimals with the language separator', () => {
    expect(formatRate(0.937251, 'en')).toBe('0.937251');
    expect(formatRate(0.937251, 'es')).toBe('0,937251');
    expect(formatRate(830, 'en')).toBe('830');
  });

  it('rounds to six decimals through roundTo', () => {
    expect(formatRate(1.0000005, 'en')).toBe('1.000001');
  });

  it.each([NaN, null, undefined, '', Infinity])('renders an em dash for unavailable value %s', (value) => {
    expect(formatRate(value, 'en')).toBe('\u2014');
  });
});

describe('formatDateOnly', () => {
  it('shows a calendar date as written, whatever the machine time zone (UTC)', () => {
    expect(formatDateOnly('2026-10-22', 'en')).toBe('Oct 22, 2026');
    expect(formatDateOnly('2026-10-22', 'es')).toMatch(/22.*2026/);
  });

  it('is empty for invalid input', () => {
    expect(formatDateOnly('nope', 'en')).toBe('');
    expect(formatDateOnly(null, 'en')).toBe('');
  });
});
