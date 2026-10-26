import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// AuthContext race condition (TEST-01 follow-up): on mount, `initialize()`
// calls getSession()+updateUserState AND the onAuthStateChange listener
// also calls updateUserState for whatever event supabase-js's internal
// _recoverAndRefresh()/_notifyAllSubscribers fires for the session already
// in storage. In real browsers this is 'SIGNED_IN' (fired before
// 'INITIAL_SESSION' — verified via direct Playwright instrumentation, not
// assumed), not always 'INITIAL_SESSION' as the naive fix first assumed.
// Both firing concurrently with initialize()'s own call double the profile
// fetch. This test reproduces the real ordering and asserts the profile is
// fetched exactly once for the initial session, not twice.

let authStateCallback = null;
const singleMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      single: singleMock
    })
  })
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

vi.mock('@/lib/constants', async (importOriginal) => {
  const actual = await importOriginal();
  // Mutable copy so a test can shrink the global init timeout.
  return { ...actual, TIMEOUTS: { ...actual.TIMEOUTS } };
});
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/AuthLoadingScreen', () => ({ default: () => null }));
vi.mock('@/lib/userCategorizationService', () => ({
  getUserCategory: vi.fn().mockResolvedValue(null)
}));
vi.mock('@/lib/activityLogger', () => ({
  flushQueuedActivityLogs: vi.fn(),
  logActivity: vi.fn()
}));

import { supabase } from '@/lib/supabase';
import { TIMEOUTS } from '@/lib/constants';
import { AuthProvider } from '@/contexts/AuthContext';

const SESSION = {
  user: { id: 'u1', email: 'u1@test.com', user_metadata: {} },
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

describe('AuthProvider — initial session race condition', () => {
  afterEach(cleanup);

  beforeEach(() => {
    TIMEOUTS.INIT_AUTH = 60000;
    authStateCallback = null;
    singleMock.mockReset();
    fromMock.mockClear();
    singleMock.mockResolvedValue({
      data: { role: 'user', is_enabled: true, avatar_url: null, full_name: 'U1', email: 'u1@test.com' },
      error: null
    });
    supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
  });

  it('fetches the profile only once when SIGNED_IN then INITIAL_SESSION fire alongside initialize()', async () => {
    render(<AuthProvider>{null}</AuthProvider>);

    // Reproduce the real supabase-js v2 ordering observed in the browser:
    // SIGNED_IN (from _recoverAndRefresh, synchronous with subscribe) fires
    // BEFORE INITIAL_SESSION, both for the same stored session, both before
    // initialize()'s own getSession() call has necessarily resolved.
    if (authStateCallback) {
      authStateCallback('SIGNED_IN', SESSION);
      authStateCallback('INITIAL_SESSION', SESSION);
    }

    await waitFor(() => {
      expect(singleMock).toHaveBeenCalled();
    });

    // Give any duplicate in-flight fetch a chance to also resolve before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(singleMock).toHaveBeenCalledTimes(1);
  });

  it('still updates user state for a real sign-in after the initial load window closes', async () => {
    render(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => {
      expect(singleMock).toHaveBeenCalledTimes(1);
    });

    singleMock.mockClear();

    const NEW_SESSION = {
      user: { id: 'u2', email: 'u2@test.com', user_metadata: {} },
      expires_at: Math.floor(Date.now() / 1000) + 3600
    };

    authStateCallback('SIGNED_IN', NEW_SESSION);

    await waitFor(() => {
      expect(singleMock).toHaveBeenCalledTimes(1);
    });
  });

  it('does not block the auth event callback on the profile fetch (supabase-js lock deadlock)', async () => {
    render(<AuthProvider>{null}</AuthProvider>);
    await waitFor(() => expect(singleMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Profile fetch never resolves: if the callback awaited it, supabase-js
    // would hold its lock forever and getSession() would hang.
    singleMock.mockReset();
    singleMock.mockReturnValue(new Promise(() => {}));

    const outcome = await Promise.race([
      Promise.resolve(authStateCallback('SIGNED_IN', SESSION)).then(() => 'returned'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100))
    ]);

    expect(outcome).toBe('returned');
  });

  it('stops ignoring auth events once the init timeout fires on a hung getSession()', async () => {
    TIMEOUTS.INIT_AUTH = 50;
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}));
    render(<AuthProvider>{null}</AuthProvider>);

    await new Promise((resolve) => setTimeout(resolve, 120)); // > INIT_AUTH (50ms)
    authStateCallback('SIGNED_IN', SESSION);

    await waitFor(() => expect(singleMock).toHaveBeenCalledTimes(1));
  });

  it('keeps ignoring events while the live StrictMode run is initializing, even after the discarded run ends', async () => {
    const pending = [];
    supabase.auth.getSession.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve))
    );
    render(
      <React.StrictMode>
        <AuthProvider>{null}</AuthProvider>
      </React.StrictMode>
    );
    await waitFor(() => expect(pending.length).toBe(2));

    // The discarded (first) run finishes while the live (second) one is still pending.
    pending[0]({ data: { session: SESSION }, error: null });
    await waitFor(() => expect(singleMock).toHaveBeenCalledTimes(1));

    authStateCallback('SIGNED_IN', SESSION);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(singleMock).toHaveBeenCalledTimes(1);
  });
});
