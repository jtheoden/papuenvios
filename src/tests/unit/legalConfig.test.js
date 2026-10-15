import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  LEGAL_VERSION,
  LEGAL_LAST_UPDATED,
  CLAIM_WINDOW_HOURS,
  REFUND_BUSINESS_DAYS,
  getSupportEmail,
} from '@/lib/legalConfig';

describe('legalConfig constants', () => {
  it('exposes an ISO date version and last-updated date', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exposes positive integer windows', () => {
    expect(Number.isInteger(CLAIM_WINDOW_HOURS)).toBe(true);
    expect(CLAIM_WINDOW_HOURS).toBeGreaterThan(0);
    expect(Number.isInteger(REFUND_BUSINESS_DAYS)).toBe(true);
    expect(REFUND_BUSINESS_DAYS).toBeGreaterThan(0);
  });
});

describe('getSupportEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when VITE_SUPPORT_EMAIL is unset', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    expect(getSupportEmail()).toBeNull();
  });

  it('returns null when the value is whitespace only', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '   ');
    expect(getSupportEmail()).toBeNull();
  });

  it('returns null when the value is not an email address', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'not-an-email');
    expect(getSupportEmail()).toBeNull();
  });

  it('returns the trimmed address when configured', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '  help@example.test ');
    expect(getSupportEmail()).toBe('help@example.test');
  });
});
