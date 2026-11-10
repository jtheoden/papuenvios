import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshSessionOnce } from '@/lib/sessionRefresh';
import { createRefreshGuardFetch, resetRefreshGuard } from '@/lib/refreshGuard';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const SESSION = { access_token: 'a', refresh_token: 'r' };

describe('refreshSessionOnce (the only explicit refresh path left)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRefreshGuard();
  });

  it('N simultaneous callers share ONE refreshSession() call and its result', async () => {
    let resolve;
    const auth = { refreshSession: vi.fn(() => new Promise((r) => { resolve = r; })) };

    const calls = Array.from({ length: 5 }, () => refreshSessionOnce(auth));
    resolve({ data: { session: SESSION }, error: null });
    const results = await Promise.all(calls);

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    results.forEach((result) => expect(result.data.session).toBe(SESSION));
  });

  it('a later call, once the first has settled, refreshes again', async () => {
    const auth = { refreshSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }) };

    await refreshSessionOnce(auth);
    await refreshSessionOnce(auth);

    expect(auth.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('does not refresh during the rate-limit cooldown: retryable error, no call', async () => {
    await createRefreshGuardFetch(async () => new Response('{}', { status: 429 }))(REFRESH_URL).catch(() => {});
    const auth = { refreshSession: vi.fn() };

    const { data, error } = await refreshSessionOnce(auth);

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(data.session).toBeNull();
    expect(error.name).toBe('AuthRetryableFetchError');
  });
});
