import { describe, it, expect } from 'vitest';
import { isSessionExpiredError, parseSupabaseError } from '@/lib/errorHandler';

describe('isSessionExpiredError', () => {
  it.each([
    [{ code: '42501', message: 'permission denied for table exchange_rates' }],
    [{ status: 401, message: 'Unauthorized' }],
    [{ code: 'PGRST301', message: 'JWT expired' }],
    [{ message: 'JWT expired' }]
  ])('detects %j', (error) => {
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it('detects it after parseSupabaseError wrapped the raw error', () => {
    const parsed = parseSupabaseError({ code: '42501', message: 'permission denied for table exchange_rates' });
    expect(isSessionExpiredError(parsed)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isSessionExpiredError(null)).toBe(false);
    expect(isSessionExpiredError({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isSessionExpiredError(new Error('network down'))).toBe(false);
  });
});
