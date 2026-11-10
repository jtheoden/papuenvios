import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoTrueClient } from '@supabase/auth-js';
import { createRefreshGuardFetch, resetRefreshGuard } from '@/lib/refreshGuard';

// Characterization against the REAL installed auth-js (2.72) with a stubbed network: which
// simultaneous triggers really produce several POST /auth/v1/token?grant_type=refresh_token.

const STORAGE_KEY = 'test-auth-concurrency';
const URL_BASE = 'https://x.supabase.co/auth/v1';
const HOUR_S = 3600;
const nowS = () => Math.floor(Date.now() / 1000);

const sessionExpiringIn = (seconds, tag = 1) => ({
  access_token: `jwt-${tag}`,
  refresh_token: `refresh-${tag}`,
  token_type: 'bearer',
  expires_in: HOUR_S,
  expires_at: nowS() + seconds,
  user: { id: 'u1', email: 'a@b.c', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }
});

const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); }
  };
};

// Serializing lock shared by several clients = what navigator.locks gives several tabs.
const sharedLock = () => {
  let tail = Promise.resolve();
  return (_name, _timeout, fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
};
const noLock = async (_name, _timeout, fn) => fn();

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// Fake server: every refresh rotates the token and answers with a session valid for one hour of SERVER time.
const makeServer = (serverNowS = nowS) => {
  let n = 1;
  const refreshCalls = [];
  const fetchImpl = vi.fn(async (input) => {
    refreshCalls.push(String(input));
    n += 1;
    return json({ ...sessionExpiringIn(0, n), expires_at: serverNowS() + HOUR_S, expires_in: HOUR_S });
  });
  return { fetchImpl, refreshCalls };
};

const makeClient = ({ fetchImpl, storage, lock = noLock, autoRefreshToken = true }) =>
  new GoTrueClient({
    url: URL_BASE,
    storageKey: STORAGE_KEY,
    storage,
    fetch: createRefreshGuardFetch(fetchImpl),
    lock,
    autoRefreshToken,
    persistSession: true,
    detectSessionInUrl: false
  });

const fireVisible = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
};

describe('auth-js refresh triggers (real library, stubbed network)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
    resetRefreshGuard();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ONE tab: getSession x5 + visibilitychange + the auto-refresh tick on an expired token = ONE refresh request', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(sessionExpiringIn(-60)) });
    const { fetchImpl } = makeServer();
    const client = makeClient({ fetchImpl, storage });

    const calls = Array.from({ length: 5 }, () => client.getSession());
    fireVisible();
    await vi.advanceTimersByTimeAsync(31_000); // one auto-refresh tick
    await Promise.all(calls);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.stopAutoRefresh();
  });

  it('TWO tabs sharing storage AND a serializing lock (navigator.locks): the second tab reuses the rotated token = ONE refresh request', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(sessionExpiringIn(-60)) });
    const { fetchImpl } = makeServer();
    const lock = sharedLock();
    const a = makeClient({ fetchImpl, storage, lock });
    const b = makeClient({ fetchImpl, storage, lock });

    const pending = Promise.all([a.getSession(), b.getSession(), a.getSession(), b.getSession()]);
    fireVisible();
    await vi.advanceTimersByTimeAsync(31_000);
    await pending;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await a.stopAutoRefresh();
    await b.stopAutoRefresh();
  });

  it('TWO tabs WITHOUT a cross-tab lock (no navigator.locks): each refreshes with the same token = TWO requests (second one would hit a rotated token)', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(sessionExpiringIn(-60)) });
    const { fetchImpl } = makeServer();
    const a = makeClient({ fetchImpl, storage, lock: noLock });
    const b = makeClient({ fetchImpl, storage, lock: noLock });

    await Promise.all([a.getSession(), b.getSession()]);

    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    await a.stopAutoRefresh();
    await b.stopAutoRefresh();
  });

  it('CLOCK AHEAD of the server by more than the token life: every fresh token already looks expired, so each getSession() refreshes again', async () => {
    const realStartMs = Date.now();
    const serverNowS = () => Math.floor((realStartMs + (Date.now() - realStartMs)) / 1000) - 2 * HOUR_S; // server = client - 2 h
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...sessionExpiringIn(-60), expires_at: serverNowS() - 60 }) });
    const { fetchImpl } = makeServer(serverNowS);
    const client = makeClient({ fetchImpl, storage, autoRefreshToken: false });

    for (let i = 0; i < 10; i += 1) {
      await client.getSession(); // e.g. one per REST request, activity log, poller...
    }

    // Without relative expiry: 10 getSession calls => 10 refresh requests (a token_refreshed/token_revoked burst).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
