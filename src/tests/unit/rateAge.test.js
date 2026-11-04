import { describe, it, expect } from 'vitest';

import { rateAgeHours, rateAgeState, RATE_STATES } from '@/lib/rateAge';

// effective_date is a calendar date; the server reads it as 00:00 UTC of that day (see _payment_fx_latest).
const NOW = new Date('2026-10-27T16:00:00Z');

describe('rateAgeHours', () => {
  it('measures from 00:00 UTC of the effective date', () => {
    expect(rateAgeHours('2026-10-22', NOW)).toBe(136);
  });

  it('is 0 for a future effective date (never negative)', () => {
    expect(rateAgeHours('2026-10-30', NOW)).toBe(0);
  });

  it.each([null, undefined, '', 'nope', '2026-13-45'])('is null for %s', (value) => {
    expect(rateAgeHours(value, NOW)).toBeNull();
  });
});

describe('rateAgeState', () => {
  const T = { warnHours: 24, blockHours: 96 };
  const date = '2026-10-20'; // 00:00Z
  const nowAfter = (hours) => new Date(Date.parse('2026-10-20T00:00:00Z') + hours * 3600 * 1000);

  it('exposes the canonical state names Bizum already uses', () => {
    expect(RATE_STATES).toEqual({ NONE: 'none', OK: 'ok', WARN: 'warn', BLOCKED: 'blocked' });
  });

  it.each([
    [23.99, 'ok'],
    [24, 'warn'], // server: age >= warn -> warn
    [95.99, 'warn'],
    [96, 'blocked'], // server: age >= block -> blocked
    [168, 'blocked']
  ])('with 24/96 thresholds, age %s h is %s', (hours, expected) => {
    expect(rateAgeState(date, { ...T, now: nowAfter(hours) })).toBe(expected);
  });

  it('honours the 168 h block threshold chosen by the owner', () => {
    const t = { warnHours: 24, blockHours: 168 };
    expect(rateAgeState(date, { ...t, now: nowAfter(167.9) })).toBe('warn');
    expect(rateAgeState(date, { ...t, now: nowAfter(168) })).toBe('blocked');
  });

  it('is none without a usable date, whatever the thresholds', () => {
    expect(rateAgeState(null, { ...T, now: NOW })).toBe('none');
    expect(rateAgeState('garbage', { now: NOW })).toBe('none');
  });

  it('is informative only without thresholds: an old rate is still ok and never blocked', () => {
    expect(rateAgeState('2020-01-01', { now: NOW })).toBe('ok');
    expect(rateAgeState('2020-01-01', { warnHours: undefined, blockHours: undefined, now: NOW })).toBe('ok');
  });

  it('applies only the thresholds that were given', () => {
    expect(rateAgeState(date, { warnHours: 24, now: nowAfter(200) })).toBe('warn');
    expect(rateAgeState(date, { blockHours: 96, now: nowAfter(50) })).toBe('ok');
  });
});
