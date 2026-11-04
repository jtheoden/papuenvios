import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoTrueClient } from '@supabase/auth-js';
import { createRefreshGuardFetch, resetRefreshGuard, getRefreshBlockRemainingMs } from '@/lib/refreshGuard';

// Runs the REAL installed auth-js against a stubbed network. It proves, against the
// library code that ships (not from memory), what a 429 on the refresh endpoint does
// to the stored session, and that the guard keeps the session instead.

const STORAGE_KEY = 'test-auth';
const URL_BASE = 'https://x.supabase.co/auth/v1';
const EXPIRED = {
  access_token: 'expired.jwt.token',
  refresh_token: 'refresh-1',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) - 600,
  user: { id: 'u1', email: 'a@b.c', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }
};
const FRESH_SESSION = {
  ...EXPIRED,
  access_token: 'fresh.jwt.token',
  refresh_token: 'refresh-2',
  expires_at: Math.floor(Date.now() / 1000) + 3600
};

const memoryStorage = (seed) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); }
  };
};

const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const rateLimited = () => jsonResponse(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });

const makeClient = (fetchImpl, storage, autoRefreshToken = false, lock = async (_name, _timeout, fn) => fn()) =>
  new GoTrueClient({
    url: URL_BASE,
    storageKey: STORAGE_KEY,
    storage,
    fetch: fetchImpl,
    lock,
    autoRefreshToken,
    persistSession: true,
    detectSessionInUrl: false
  });

describe('auth-js 2.x behaviour on a 429 from the refresh endpoint', () => {
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

  it('WITHOUT the guard: a single 429 deletes the stored session and emits SIGNED_OUT (why the dashboard showed "Autenticacion requerida")', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const fetchMock = vi.fn().mockImplementation(async () => rateLimited());
    const client = makeClient(fetchMock, storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    const result = client.getSession();
    await vi.advanceTimersByTimeAsync(60_000);
    const { data, error } = await result;

    expect(data.session).toBeNull();
    expect(error?.status).toBe(429);
    expect(storage.getItem(STORAGE_KEY)).toBeNull(); // refresh token is gone for good
    expect(events).toContain('SIGNED_OUT');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 429 is not retried by auth-js
  });

  it('WITH the guard: the 429 does not wipe the session, emits no SIGNED_OUT and the network sees a handful of requests instead of every attempt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic cooldowns: 30 s, 60 s, 120 s...
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const network = vi.fn().mockImplementation(async () => rateLimited());
    const guarded = createRefreshGuardFetch(network);
    const attempts = vi.fn(guarded);
    const client = makeClient(attempts, storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    // Five callers (pollers, role retries, ...) each asking for a token over ~130 s.
    for (let i = 0; i < 5; i += 1) {
      const pending = client.getSession();
      await vi.advanceTimersByTimeAsync(26_000);
      const { data } = await pending;
      expect(data.session).toBeNull(); // no usable token yet, but nothing destroyed
    }

    expect(JSON.parse(storage.getItem(STORAGE_KEY)).refresh_token).toBe('refresh-1');
    expect(events).not.toContain('SIGNED_OUT');
    expect(attempts.mock.calls.length).toBeGreaterThanOrEqual(30); // what auth-js would have sent
    expect(network.mock.calls.length).toBeLessThanOrEqual(3); // what actually reached /token
    expect(getRefreshBlockRemainingMs()).toBeGreaterThan(0);
  });

  it('WITH the guard: once the cooldown ends, a single refresh recovers the session and emits TOKEN_REFRESHED', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const network = vi.fn()
      .mockImplementationOnce(async () => rateLimited())
      .mockImplementation(async () => jsonResponse(200, FRESH_SESSION));
    const client = makeClient(createRefreshGuardFetch(network), storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    const first = client.getSession();
    await vi.advanceTimersByTimeAsync(60_000);
    await first;

    await vi.advanceTimersByTimeAsync(getRefreshBlockRemainingMs() + 1);
    const { data, error } = await client.getSession();

    expect(error).toBeNull();
    expect(data.session.access_token).toBe('fresh.jwt.token');
    expect(events).toContain('TOKEN_REFRESHED');
    expect(events).not.toContain('SIGNED_OUT');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('WITH the guard: signOut() cannot load the expired session while blocked, fails after the retry loop and leaves the session in storage', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const client = makeClient(createRefreshGuardFetch(vi.fn().mockImplementation(async () => rateLimited())), storage);

    const out = client.signOut();
    await vi.advanceTimersByTimeAsync(60_000);
    const { error } = await out;

    expect(error?.name).toBe('AuthRetryableFetchError');
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull(); // why AuthContext signs out locally in this case
  });

  it('WITH the guard and autoRefreshToken: getSession() right after a reload keeps retrying locally for a long time (why the UI must say "reconnecting" meanwhile)', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const client = makeClient(createRefreshGuardFetch(vi.fn().mockImplementation(async () => rateLimited())), storage, true);
    const startedAt = Date.now();
    let settledAt = null;
    const pending = client.getSession().then((r) => { settledAt = Date.now(); return r; });

    for (let i = 0; i < 900 && settledAt === null; i += 1) await vi.advanceTimersByTimeAsync(1000);
    await pending;
    await client.stopAutoRefresh();

    expect(settledAt - startedAt).toBeGreaterThan(20_000); // measured ~200 s with auth-js 2.72.0
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull(); // slow, but the session is never lost
  });

  const transient = [
    ['500 JSON', () => jsonResponse(500, { code: 500, msg: 'Internal error' })],
    ['520 HTML (Cloudflare)', () => new Response('<html>error</html>', { status: 520, headers: { 'content-type': 'text/html' } })],
    ['408 request timeout', () => jsonResponse(408, { code: 408, msg: 'timeout' })]
  ];

  it.each(transient)('WITHOUT the guard: a %s on refresh also deletes the session (same class of bug as the 429)', async (_label, make) => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const client = makeClient(vi.fn().mockImplementation(async () => make()), storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    const pending = client.getSession();
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });

  it.each(transient)('WITH the guard: a %s on refresh keeps the session and emits no SIGNED_OUT', async (_label, make) => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const client = makeClient(createRefreshGuardFetch(vi.fn().mockImplementation(async () => make())), storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    const pending = client.getSession();
    await vi.advanceTimersByTimeAsync(60_000);
    const { data } = await pending;

    expect(data.session).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).refresh_token).toBe('refresh-1');
    expect(events).not.toContain('SIGNED_OUT');
  });

  it('WITH the guard: a 401 invalid_grant style answer still ends the session', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const client = makeClient(createRefreshGuardFetch(vi.fn().mockImplementation(async () =>
      jsonResponse(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }))), storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    await client.getSession();

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });

  it('W1 (inherent): with a FIFO lock like navigator.locks, concurrent getSession() calls during the cooldown run one after another (~25 s each) and nobody loses the session', async () => {
    let tail = Promise.resolve();
    const fifoLock = (_name, _timeout, fn) => {
      const run = tail.then(fn, fn);
      tail = run.then(() => {}, () => {});
      return run;
    };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const network = vi.fn().mockImplementation(async () => rateLimited());
    const client = makeClient(createRefreshGuardFetch(network), storage, false, fifoLock);
    const startedAt = Date.now();
    const settled = [];
    const calls = [1, 2, 3].map(() => client.getSession().then((r) => { settled.push(Date.now() - startedAt); return r; }));

    for (let i = 0; i < 400 && settled.length < 3; i += 1) await vi.advanceTimersByTimeAsync(1000);
    const results = await Promise.all(calls);

    results.forEach(({ data }) => expect(data.session).toBeNull());
    expect(settled[0]).toBeGreaterThan(20_000); // each call spends the local retry loop holding the lock
    expect(settled[1] - settled[0]).toBeGreaterThan(20_000);
    expect(settled[2] - settled[1]).toBeGreaterThan(20_000); // serialized, not parallel
    expect(network.mock.calls.length).toBeLessThanOrEqual(3); // yet the endpoint only saw a few requests
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('WITH the guard: a genuinely invalid refresh token still ends the session (no endless "reconnecting")', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(EXPIRED) });
    const network = vi.fn().mockImplementation(async () =>
      jsonResponse(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }));
    const client = makeClient(createRefreshGuardFetch(network), storage);
    const events = [];
    client.onAuthStateChange((event) => { events.push(event); });

    const { data } = await client.getSession();

    expect(data.session).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });
});
