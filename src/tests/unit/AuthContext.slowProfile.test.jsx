import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

// A slow/lossy network must never downgrade a person to 'user': an
// unresolved profile keeps the role null (or the cached one as PROVISIONAL)
// and is retried in the background until the fresh profile arrives.

let authStateCallback = null;
const singleMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: singleMock }) })
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn((cb) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    },
    from: (...args) => fromMock(...args)
  }
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/AuthLoadingScreen', () => ({ default: () => null }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/userCategorizationService', () => ({
  getUserCategory: vi.fn().mockResolvedValue(null)
}));
vi.mock('@/lib/activityLogger', () => ({
  flushQueuedActivityLogs: vi.fn(),
  logActivity: vi.fn()
}));

import { supabase } from '@/lib/supabase';
import { logActivity, flushQueuedActivityLogs } from '@/lib/activityLogger';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import RoleUnresolvedBanner from '@/components/RoleUnresolvedBanner';

const SESSION = {
  user: { id: 'u1', email: 'u1@test.com', user_metadata: {} },
  expires_at: 4102444800
};
const profile = (role, extra = {}) => ({
  data: { role, is_enabled: true, avatar_url: null, full_name: 'U1', email: 'u1@test.com', ...extra },
  error: null
});
const hang = () => new Promise(() => {});
const CACHE_KEY = 'auth_role_u1';

const Probe = () => {
  const { userRole, roleStatus, user, roleRetryExhausted, roleFetchFailed, roleVerifyTimedOut, retryRoleResolution, checkAndRefreshSession } = useAuth();
  return (
    <div>
      <div data-testid="probe">{`${userRole}|${roleStatus}|${user ? 'user' : 'anon'}`}</div>
      <div data-testid="exhausted">{String(roleRetryExhausted)}</div>
      <div data-testid="failed">{String(roleFetchFailed)}</div>
      <div data-testid="timedout">{String(roleVerifyTimedOut)}</div>
      <RoleUnresolvedBanner />
      <button onClick={retryRoleResolution}>manual-retry</button>
      <button onClick={checkAndRefreshSession}>check-session</button>
    </div>
  );
};
const probe = () => screen.getByTestId('probe').textContent;
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const mountApp = async (ui = <Probe />) => {
  const utils = render(<AuthProvider>{ui}</AuthProvider>);
  await advance(0);
  return utils;
};
// 2 attempts x 12 s + 300 ms delay (initial resolution is allowed to be slow).
const FIRST_RESOLUTION_FAILED = 24400;

describe('AuthProvider — slow / failing profile fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    authStateCallback = null;
    singleMock.mockReset();
    fromMock.mockClear();
    supabase.auth.signOut.mockClear();
    logActivity.mockClear();
    flushQueuedActivityLogs.mockClear();
    supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('(a) never falls back to "user" with no cache; shows a banner; recovers on a background retry', async () => {
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(FIRST_RESOLUTION_FAILED);

    expect(probe()).toBe('null|unresolved|user');
    expect(screen.getByRole('status')).toBeTruthy();

    singleMock.mockResolvedValue(profile('super_admin'));
    await advance(2000); // first backoff step

    expect(probe()).toBe('super_admin|resolved|user');
    expect(screen.queryByRole('status')).toBeNull();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)).role).toBe('super_admin');
  });

  it('(b) uses a cached role as PROVISIONAL and the fresh profile always wins', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ role: 'super_admin', ts: Date.now() }));
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(FIRST_RESOLUTION_FAILED);

    expect(probe()).toBe('super_admin|provisional|user');

    singleMock.mockResolvedValue(profile('admin'));
    await advance(2000);

    expect(probe()).toBe('admin|resolved|user');
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)).role).toBe('admin');
  });

  it('ignores a cached role older than 30 days', async () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ role: 'super_admin', ts: old }));
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(FIRST_RESOLUTION_FAILED);

    expect(probe()).toBe('null|unresolved|user');
  });

  it('(c) only the latest updateUserState call applies (out-of-order responses)', async () => {
    singleMock.mockResolvedValueOnce(profile('user'));
    await mountApp();
    expect(probe()).toBe('user|resolved|user');

    let resolveOld;
    let resolveNew;
    singleMock
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveNew = r; }));
    // USER_UPDATED (metadata changed) re-reads the profile; token refreshes do not (see below)
    await act(async () => {
      authStateCallback('USER_UPDATED', SESSION);
      authStateCallback('USER_UPDATED', SESSION);
    });

    await act(async () => { resolveNew(profile('admin')); });
    await act(async () => { resolveOld(profile('user')); });

    expect(probe()).toBe('admin|resolved|user');
  });

  it('egress: token refreshes and the SIGNED_IN re-emitted on focus do not re-read an already loaded profile', async () => {
    singleMock.mockResolvedValueOnce(profile('admin'));
    await mountApp();
    expect(probe()).toBe('admin|resolved|user');
    singleMock.mockClear();

    await act(async () => {
      authStateCallback('TOKEN_REFRESHED', SESSION);
      authStateCallback('SIGNED_IN', SESSION);
      authStateCallback('TOKEN_REFRESHED', SESSION);
    });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(60_000);

    expect(singleMock).not.toHaveBeenCalled();
    expect(probe()).toBe('admin|resolved|user');
  });

  it('a SIGNED_IN on focus more than 5 min after the last read re-reads the profile (a demotion is seen)', async () => {
    singleMock.mockResolvedValueOnce(profile('admin'));
    await mountApp();
    expect(probe()).toBe('admin|resolved|user');

    singleMock.mockClear();
    singleMock.mockResolvedValue(profile('user'));
    await advance(5 * 60_000 + 1_000);
    await act(async () => { authStateCallback('SIGNED_IN', SESSION); });
    await advance(0);
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('user|resolved|user');
  });

  it('a TOKEN_REFRESHED (hourly, tab always visible) re-reads a profile older than 5 min: a disabled admin is seen', async () => {
    singleMock.mockResolvedValueOnce(profile('admin'));
    await mountApp();
    singleMock.mockClear();

    await act(async () => { authStateCallback('TOKEN_REFRESHED', SESSION); }); // fresh profile: no request
    expect(singleMock).not.toHaveBeenCalled();

    singleMock.mockResolvedValue(profile('user'));
    await advance(5 * 60_000 + 1_000);
    await act(async () => { authStateCallback('TOKEN_REFRESHED', SESSION); });
    await advance(0);
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('user|resolved|user');
  });

  it('(d) retries immediately on "online" and when the tab becomes visible', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(probe()).toBe('null|unresolved|user');

    singleMock.mockClear();
    singleMock.mockResolvedValue(profile('admin'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await advance(1000); // resume triggers are debounced (500-1000 ms)
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('admin|resolved|user');
  });

  it('(d) visibilitychange retries only when the page is visible', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    singleMock.mockClear();
    singleMock.mockResolvedValue(profile('admin'));

    const setVisibility = (value) =>
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(1000);
    expect(singleMock).not.toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(1000);
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('admin|resolved|user');
  });

  it('the banner "retry" button triggers an immediate attempt', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    singleMock.mockClear();
    singleMock.mockResolvedValue(profile('admin'));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'auth.roleRetry' })); });

    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('admin|resolved|user');
  });

  it('(e) stops retrying after sign-out and drops the cached role', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ role: 'admin', ts: Date.now() }));
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);

    await act(async () => { authStateCallback('SIGNED_OUT', null); });
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();

    singleMock.mockClear();
    await advance(120000);
    expect(singleMock).not.toHaveBeenCalled();
    expect(probe()).toBe('null|resolved|anon');
  });

  it('(e) stops retrying after unmount', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { unmount } = await mountApp();
    await advance(400);

    unmount();
    singleMock.mockClear();
    await advance(120000);
    expect(singleMock).not.toHaveBeenCalled();
  });

  it('(e) is StrictMode-safe: no duplicated retry loops', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    render(<React.StrictMode><AuthProvider><Probe /></AuthProvider></React.StrictMode>);
    await advance(1000);
    singleMock.mockClear();

    await advance(2000); // first backoff step: exactly one retry (2 fetch attempts per retry)
    const callsInOneRetry = singleMock.mock.calls.length;
    expect(callsInOneRetry).toBeLessThanOrEqual(2);
    expect(callsInOneRetry).toBeGreaterThan(0);
  });

  it('(f) a disabled profile still signs the person out and drops the cache', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ role: 'admin', ts: Date.now() }));
    singleMock.mockResolvedValue(profile('admin', { is_enabled: false }));
    await mountApp();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(probe()).toBe('null|resolved|anon');
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('(g) a 7 s response (slower than the old 5 s timeout) succeeds on the first attempt', async () => {
    singleMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(profile('super_admin')), 7000))
    );
    await mountApp();
    await advance(7100);

    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('super_admin|resolved|user');
  });

  it('a disabled profile never logs a login nor flushes activity logs', async () => {
    singleMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(profile('admin', { is_enabled: false })), 1000))
    );
    await mountApp();
    await advance(1100);
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(flushQueuedActivityLogs).not.toHaveBeenCalled();
  });

  it('logs the login once, only after the role is resolved', async () => {
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(FIRST_RESOLUTION_FAILED);
    expect(logActivity).not.toHaveBeenCalled();

    singleMock.mockResolvedValue(profile('admin'));
    await advance(2000);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it('caps background retries at PROFILE_RECOVERY_MAX_ATTEMPTS, exposes exhaustion, and the manual retry restarts the budget', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(screen.getByTestId('exhausted').textContent).toBe('false');

    await advance(900000);
    const total = singleMock.mock.calls.length;
    expect(total).toBe(2 + 20 * 2); // initial (2 attempts) + 20 recovery rounds (2 attempts each)
    expect(screen.getByTestId('exhausted').textContent).toBe('true');

    await advance(900000);
    expect(singleMock.mock.calls.length).toBe(total);

    singleMock.mockResolvedValue(profile('admin'));
    await act(async () => { fireEvent.click(screen.getByText('manual-retry')); });
    expect(probe()).toBe('admin|resolved|user');
    expect(screen.getByTestId('exhausted').textContent).toBe('false');
  });

  it('switching user A to B leaks neither the role nor the cache of A', async () => {
    singleMock.mockResolvedValueOnce(profile('super_admin'));
    await mountApp();
    expect(probe()).toBe('super_admin|resolved|user');

    singleMock.mockImplementation(hang);
    const SESSION_B = { ...SESSION, user: { id: 'u2', email: 'u2@test.com', user_metadata: {} } };
    await act(async () => { authStateCallback('SIGNED_IN', SESSION_B); });
    await advance(FIRST_RESOLUTION_FAILED);

    expect(probe()).toBe('null|unresolved|user');
    expect(localStorage.getItem('auth_role_u2')).toBeNull();
  });

  it('a failed profile fetch on TOKEN_REFRESHED keeps an already resolved role', async () => {
    singleMock.mockResolvedValueOnce(profile('super_admin'));
    await mountApp();

    singleMock.mockImplementation(hang);
    await act(async () => { authStateCallback('TOKEN_REFRESHED', SESSION); });
    await advance(10600); // 2 x 5 s + 300 ms

    expect(probe()).toBe('super_admin|resolved|user');
  });

  it('checkAndRefreshSession with a lost session fully resets role state', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(probe()).toBe('null|unresolved|user');

    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await act(async () => { fireEvent.click(screen.getByText('check-session')); });

    expect(probe()).toBe('null|resolved|anon');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('exposes roleFetchFailed after the first failed resolution and clears it on success', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(screen.getByTestId('failed').textContent).toBe('true');

    singleMock.mockResolvedValue(profile('admin'));
    await advance(2000);
    expect(screen.getByTestId('failed').textContent).toBe('false');
  });

  it('reports (once, no PII) when the role recovery gives up', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    await advance(900000);

    expect(screen.getByTestId('exhausted').textContent).toBe('true');
    const reports = errorSpy.mock.calls.filter(([label, entry]) => label === '[ERROR]' && entry?.context?.source === 'auth.roleRecoveryExhausted');
    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports[0][1])).not.toContain('u1@test.com');
  });

  it('a success on the very last recovery attempt does not leave roleRetryExhausted set', async () => {
    let calls = 0;
    singleMock.mockImplementation(async () => {
      calls += 1;
      // initial resolution = 2 calls, 19 failing recovery rounds = 38 calls; the 20th round succeeds
      return calls > 40 ? profile('admin') : { data: null, error: { message: 'boom' } };
    });
    await mountApp();
    await advance(400);
    await advance(900000);

    expect(probe()).toBe('admin|resolved|user');
    expect(screen.getByTestId('exhausted').textContent).toBe('false');
  });

  it('flags roleVerifyTimedOut ~15 s after the first fetch starts (even if it is still in flight) and clears it on resolve', async () => {
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(6100); // global init timeout lets the tree render
    expect(screen.getByTestId('timedout').textContent).toBe('false');

    await advance(9000); // 15.1 s in total
    expect(screen.getByTestId('timedout').textContent).toBe('true');

    singleMock.mockResolvedValue(profile('admin'));
    await advance(10000); // first fetch fails at ~24.3 s
    await advance(3000); // first backoff retry succeeds
    expect(probe()).toBe('admin|resolved|user');
    expect(screen.getByTestId('timedout').textContent).toBe('false');
  });

  it('switching user without SIGNED_OUT resets the failed/exhausted flags', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    await advance(900000);
    expect(screen.getByTestId('exhausted').textContent).toBe('true');

    singleMock.mockImplementation(hang);
    const SESSION_B = { ...SESSION, user: { id: 'u2', email: 'u2@test.com', user_metadata: {} } };
    await act(async () => { authStateCallback('SIGNED_IN', SESSION_B); });

    expect(screen.getByTestId('exhausted').textContent).toBe('false');
    expect(screen.getByTestId('failed').textContent).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the banner visible while a recovery retry of the same user is in flight (no flicker)', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(screen.getByRole('status')).toBeTruthy();

    singleMock.mockClear();
    singleMock.mockImplementation(hang);
    await advance(2100); // first backoff retry starts and hangs
    expect(singleMock).toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByTestId('failed').textContent).toBe('true');
  });

  it('manual retry works after ROLE_VERIFY_MAX while the first fetch is still in flight (no profileFailed yet)', async () => {
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(6100);
    await advance(9000); // 15.1 s: verify budget elapsed, first fetch still hanging
    expect(screen.getByTestId('timedout').textContent).toBe('true');
    expect(screen.getByTestId('failed').textContent).toBe('false');

    const before = singleMock.mock.calls.length;
    singleMock.mockResolvedValue(profile('admin'));
    await act(async () => { fireEvent.click(screen.getByText('manual-retry')); });

    expect(singleMock.mock.calls.length).toBeGreaterThan(before);
    expect(probe()).toBe('admin|resolved|user');
  });

  it('a hanging first fetch is not superseded by timer retries: the failure banner appears when it times out', async () => {
    singleMock.mockImplementation(hang);
    await mountApp();
    await advance(6100);
    await advance(18200); // 24.3 s: both 12 s attempts timed out
    await advance(100);
    expect(screen.getByTestId('failed').textContent).toBe('true');
    expect(screen.getByRole('status')).toBeTruthy();
    expect(singleMock).toHaveBeenCalledTimes(2); // no extra timer-driven request before the failure
  });
});
