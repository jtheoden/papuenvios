import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

// A refresh-token rate limit (429) must not look like a sign-out. The session is kept,
// role/activity retries pause, the UI says it is reconnecting, and everything resumes
// by itself when the refresh works again. A real sign-out stays a sign-out.

let authStateCallback = null;
const singleMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: singleMock }) })
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: null }, error: null }),
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
import { toast } from '@/components/ui/use-toast';
import { flushQueuedActivityLogs } from '@/lib/activityLogger';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import RoleUnresolvedBanner from '@/components/RoleUnresolvedBanner';
import { createRefreshGuardFetch, resetRefreshGuard, getRefreshBlockRemainingMs, isRefreshBlocked } from '@/lib/refreshGuard';
import { AUTH_STORAGE_KEY, TIMEOUTS } from '@/lib/constants';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const SESSION = {
  user: { id: 'u1', email: 'u1@test.com', user_metadata: {} },
  expires_at: 4102444800
};
const profile = (role) => ({
  data: { role, is_enabled: true, avatar_url: null, full_name: 'U1', email: 'u1@test.com' },
  error: null
});
const retryableError = Object.assign(new Error('Token refresh paused'), { name: 'AuthRetryableFetchError', __isAuthError: true, status: 0 });

// Drives the real guard exactly like a 429 from /token would.
const rateLimitTheRefresh = async () => {
  const guarded = createRefreshGuardFetch(async () => new Response('{}', { status: 429 }));
  await act(async () => { await guarded(REFRESH_URL).catch(() => {}); });
};

const Probe = () => {
  const { userRole, roleStatus, user, sessionStatus, logout, login, signInWithGoogle, checkAndRefreshSession } = useAuth();
  return (
    <div>
      <div data-testid="probe">{`${userRole}|${roleStatus}|${user ? 'user' : 'anon'}`}</div>
      <div data-testid="session">{sessionStatus}</div>
      <RoleUnresolvedBanner />
      <button onClick={logout}>logout</button>
      <button onClick={signInWithGoogle}>google</button>
      <button onClick={() => login('a@b.c', 'x')}>login</button>
      <button onClick={checkAndRefreshSession}>check-session</button>
    </div>
  );
};
const probe = () => screen.getByTestId('probe').textContent;
const sessionStatus = () => screen.getByTestId('session').textContent;
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const mountApp = async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await advance(0);
};

describe('AuthProvider — refresh rate limit (429) and session recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    localStorage.clear();
    resetRefreshGuard();
    authStateCallback = null;
    singleMock.mockReset();
    fromMock.mockClear();
    flushQueuedActivityLogs.mockClear();
    supabase.auth.getSession.mockReset();
    supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    supabase.auth.signOut.mockReset();
    supabase.auth.signOut.mockResolvedValue({ error: null });
    toast.mockClear();
    supabase.auth.refreshSession.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the person signed in with their role while reconnecting, then returns to normal by itself', async () => {
    singleMock.mockResolvedValue(profile('super_admin'));
    await mountApp();
    expect(probe()).toBe('super_admin|resolved|user');
    expect(sessionStatus()).toBe('ok');

    await rateLimitTheRefresh();

    expect(probe()).toBe('super_admin|resolved|user'); // role not degraded, user not dropped
    expect(sessionStatus()).toBe('reconnecting');
    expect(screen.getByRole('status').textContent).toContain('auth.sessionReconnecting');

    await advance(getRefreshBlockRemainingMs() + 1000); // cooldown over: the recovery loop asks for the session again
    expect(supabase.auth.getSession.mock.calls.length).toBeGreaterThan(1);
    expect(sessionStatus()).toBe('ok');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not hit the session API while the refresh is blocked (no burst from the recovery loop)', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await rateLimitTheRefresh();
    const before = supabase.auth.getSession.mock.calls.length;

    await advance(getRefreshBlockRemainingMs() - 1000);

    expect(supabase.auth.getSession.mock.calls.length).toBe(before);
  });

  it('pauses background role retries and activity flushes while reconnecting, and resumes after', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await mountApp();
    await advance(400);
    expect(probe()).toBe('null|unresolved|user');

    await rateLimitTheRefresh();
    await advance(0);
    const profileCallsAtPause = singleMock.mock.calls.length;
    const pausedFor = getRefreshBlockRemainingMs() - 1000;
    await advance(pausedFor);
    expect(singleMock.mock.calls.length).toBe(profileCallsAtPause);

    singleMock.mockResolvedValue(profile('admin'));
    // One second at a time: effects re-arm between renders, like in a browser.
    for (let i = 0; i < 40; i += 1) await advance(1000);
    expect(sessionStatus()).toBe('ok');
    expect(probe()).toBe('admin|resolved|user');
  });

  it('does not flush queued activity logs while reconnecting; flushes once the session is back', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    flushQueuedActivityLogs.mockClear();

    await rateLimitTheRefresh();
    await advance(getRefreshBlockRemainingMs() - 1000);
    expect(flushQueuedActivityLogs).not.toHaveBeenCalled();

    await advance(2000);
    expect(sessionStatus()).toBe('ok');
    expect(flushQueuedActivityLogs).toHaveBeenCalledTimes(1);
  });

  it('on page load with an expired token and a blocked refresh: reconnecting (not signed out), recovers without a reload', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: retryableError });
    singleMock.mockResolvedValue(profile('super_admin'));
    await mountApp();

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('reconnecting');

    await advance(60_000); // recovery loop: getSession now returns the refreshed session
    expect(sessionStatus()).toBe('ok');
    expect(probe()).toBe('super_admin|resolved|user');
  });

  it('a reload during the cooldown shows "reconnecting" while auth-js is still retrying, not the generic sign-in box', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'r', expires_at: 1 }));
    await rateLimitTheRefresh(); // cooldown persisted by the previous page
    resetRefreshGuard({ keepStorage: true }); // fresh page load: in-memory state gone, storage kept
    expect(isRefreshBlocked()).toBe(true);
    supabase.auth.getSession.mockReset();
    supabase.auth.getSession.mockImplementation(() => new Promise(() => {})); // init refresh loop still running (~25-50 s)

    render(<AuthProvider><Probe /></AuthProvider>);
    await advance(TIMEOUTS.INIT_AUTH + 100);

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('reconnecting');
  });

  it('a sign-out clears the cooldown: a logged-out visitor is not left "reconnecting"', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await rateLimitTheRefresh();
    expect(sessionStatus()).toBe('reconnecting');

    await act(async () => { authStateCallback('SIGNED_OUT', null); });

    expect(isRefreshBlocked()).toBe(false);
    expect(sessionStatus()).toBe('expired');
  });

  it('logout while the refresh is blocked signs out locally at once (auth-js signOut would stall and then keep the session)', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    localStorage.setItem(AUTH_STORAGE_KEY, '{"refresh_token":"r"}');
    localStorage.setItem(`${AUTH_STORAGE_KEY}-user`, '{}');
    await rateLimitTheRefresh();

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${AUTH_STORAGE_KEY}-user`)).toBeNull();
    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('ok');
    expect(isRefreshBlocked()).toBe(false);
  });

  it('logout falls back to a local sign-out when auth-js reports a retryable error', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    localStorage.setItem(AUTH_STORAGE_KEY, '{"refresh_token":"r"}');
    supabase.auth.signOut.mockResolvedValueOnce({ error: retryableError });

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(probe()).toBe('null|resolved|anon');
  });

  it('a fresh session with plenty of life left clears "reconnecting" even if the cooldown is still running', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await rateLimitTheRefresh();
    expect(sessionStatus()).toBe('reconnecting');

    await act(async () => { authStateCallback('SIGNED_IN', SESSION); }); // SESSION is valid for years
    await advance(0);

    expect(sessionStatus()).toBe('ok');
  });

  it('a session about to expire does not clear "reconnecting"', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await rateLimitTheRefresh();

    const almostExpired = { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 30 };
    await act(async () => { authStateCallback('SIGNED_IN', almostExpired); });
    await advance(0);

    expect(sessionStatus()).toBe('reconnecting');
  });

  it('a visitor with no stored session is never told "reconnecting" because of a persisted cooldown', async () => {
    await rateLimitTheRefresh();
    resetRefreshGuard({ keepStorage: true });
    expect(isRefreshBlocked()).toBe(true);
    supabase.auth.getSession.mockReset();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await mountApp();

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('ok');
  });

  it('logout with a blocked refresh but a token that still has life left uses the normal signOut (it works and revokes the session)', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3000 }));
    await rateLimitTheRefresh();

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(probe()).toBe('null|resolved|anon');
  });

  it('a local sign-out tells the person it only closed this device', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'r', expires_at: 1 }));
    await rateLimitTheRefresh();

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/este dispositivo/i) }));
  });

  it('a failed normal signOut shows the error toast and keeps the person signed in', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    supabase.auth.signOut.mockResolvedValueOnce({ error: Object.assign(new Error('boom'), { name: 'AuthApiError', status: 500 }) });

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(probe()).toBe('admin|resolved|user');
  });

  it('a successful login clears a lingering cooldown', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null });
    await mountApp();
    await rateLimitTheRefresh();
    expect(isRefreshBlocked()).toBe(true);

    await act(async () => { fireEvent.click(screen.getByText('login')); });

    expect(isRefreshBlocked()).toBe(false);
    expect(sessionStatus()).toBe('ok');
  });

  it('another tab signing out (auth storage emptied) signs this tab out too', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: null, oldValue: '{"x":1}' }));
    });

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('expired');
  });

  it('ignores storage events that do not empty the auth key', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: '{"x":2}' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: null }));
    });

    expect(probe()).toBe('admin|resolved|user');
  });

  it('stops listening to storage events when unmounted', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    const spy = vi.spyOn(window, 'removeEventListener');
    await mountApp();
    cleanup();
    expect(spy.mock.calls.some(([type]) => type === 'storage')).toBe(true);
  });

  it('explicit logout is not reported as expired even when observed between SIGNED_OUT and signOut returning', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    let finish;
    supabase.auth.signOut.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ error: null }); }));
    await mountApp();

    await act(async () => { fireEvent.click(screen.getByText('logout')); });
    await act(async () => { await authStateCallback('SIGNED_OUT', null); }); // auth-js emits it before signOut() resolves

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('ok'); // would be "expired" if the explicit flag were ignored

    await act(async () => { finish(); });
    expect(sessionStatus()).toBe('ok');
  });

  it('reconnecting caused by a network error on init (no cooldown) ends with a SIGNED_OUT: recovery stops', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: retryableError });
    await mountApp();
    expect(sessionStatus()).toBe('reconnecting');
    expect(isRefreshBlocked()).toBe(false);

    await act(async () => { authStateCallback('SIGNED_OUT', null); });
    const calls = supabase.auth.getSession.mock.calls.length;
    await advance(120_000);

    expect(sessionStatus()).toBe('ok');
    expect(supabase.auth.getSession.mock.calls.length).toBe(calls); // loop is gone
  });

  it('recovery that finds no session and no error stops reconnecting', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: retryableError });
    await mountApp();
    expect(sessionStatus()).toBe('reconnecting');

    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await advance(6000);

    expect(sessionStatus()).toBe('ok');
    expect(probe()).toBe('null|resolved|anon');
  });

  it('a Google sign-in whose signOut emits no event does not leave the explicit flag stuck: a later real expiry is still reported', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await act(async () => { fireEvent.click(screen.getByText('google')); }); // signOut mock resolves without emitting SIGNED_OUT

    await act(async () => { authStateCallback('SIGNED_OUT', null); });

    expect(sessionStatus()).toBe('expired');
  });

  it('a SIGNED_OUT that the person did not ask for is reported as expired', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();

    await act(async () => { authStateCallback('SIGNED_OUT', null); });

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('expired');
    const reports = errorSpy.mock.calls.filter(([label, entry]) => label === '[ERROR]' && entry?.context?.source === 'auth.sessionEnded');
    expect(reports).toHaveLength(1); // diagnosable, and no email/id in it
    expect(JSON.stringify(reports[0][1])).not.toContain('u1@test.com');
  });

  it('an explicit logout is not reported as an expired session', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    // Like auth-js: signOut() emits SIGNED_OUT while the session is still known, then resolves.
    supabase.auth.signOut.mockImplementationOnce(async () => {
      await authStateCallback('SIGNED_OUT', null);
      return { error: null };
    });
    await mountApp();

    await act(async () => { fireEvent.click(screen.getByText('logout')); });

    expect(probe()).toBe('null|resolved|anon');
    expect(sessionStatus()).toBe('ok');
  });

  it('a new session clears the expired state', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    await act(async () => { authStateCallback('SIGNED_OUT', null); });
    expect(sessionStatus()).toBe('expired');

    await act(async () => { authStateCallback('SIGNED_IN', SESSION); });
    await advance(0);

    expect(sessionStatus()).toBe('ok');
    expect(probe()).toBe('admin|resolved|user');
  });

  it('checkAndRefreshSession never forces a refresh of its own: getSession() lets auth-js refresh when due (single-flight, under its lock)', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 10 } }, error: null });
    supabase.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: retryableError });
    await mountApp();

    await act(async () => { fireEvent.click(screen.getByText('check-session')); });
    await act(async () => { fireEvent.click(screen.getByText('check-session')); });

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(probe()).toBe('admin|resolved|user');
  });

  describe('resume triggers (visibilitychange / online) while reconnecting', () => {
    const stuck = { data: { session: null }, error: retryableError };
    const setVisible = () => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

    // Cooldown over but the session is still not back: the loop has just made its own attempt.
    const reconnectingWithCooldownOver = async () => {
      singleMock.mockResolvedValue(profile('admin'));
      await mountApp();
      await rateLimitTheRefresh();
      supabase.auth.getSession.mockResolvedValue(stuck);
      await advance(getRefreshBlockRemainingMs() + 1);
      supabase.auth.getSession.mockClear();
    };

    it('visibilitychange followed by online a moment later makes ONE session attempt, not one per event', async () => {
      setVisible();
      await reconnectingWithCooldownOver();

      document.dispatchEvent(new Event('visibilitychange'));
      await advance(100);
      window.dispatchEvent(new Event('online'));
      await advance(100);
      document.dispatchEvent(new Event('visibilitychange'));
      await advance(2000);

      expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
      expect(sessionStatus()).toBe('reconnecting');
    });

    it('a burst of triggers INSIDE the cooldown reaches neither the session API nor the network, keeps the session, and one retry after the cooldown recovers', async () => {
      setVisible();
      singleMock.mockResolvedValue(profile('admin'));
      await mountApp();
      await rateLimitTheRefresh();
      supabase.auth.getSession.mockClear();

      for (let i = 0; i < 6; i += 1) {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
        await advance(300);
      }
      await advance(2000);

      expect(supabase.auth.getSession).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
      expect(probe()).toBe('admin|resolved|user');
      expect(sessionStatus()).toBe('reconnecting');

      await advance(getRefreshBlockRemainingMs() + 1000);

      expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
      expect(sessionStatus()).toBe('ok');
    });
  });

  it('does not poll the session on a timer of its own (auth-js already refreshes every 30 s)', async () => {
    singleMock.mockResolvedValue(profile('admin'));
    await mountApp();
    const calls = supabase.auth.getSession.mock.calls.length;

    await advance(11 * 60 * 1000);

    expect(supabase.auth.getSession.mock.calls.length).toBe(calls);
  });
});
