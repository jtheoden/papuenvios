import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/errorHandler', () => ({ logError: vi.fn() }));

import { logError } from '@/lib/errorHandler';
import { createRequestBudgetFetch, subscribeApiWrites, API_CACHE_STORAGE_KEY } from '@/lib/requestBudget';

const BASE = 'https://x.supabase.co/rest/v1';
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...init.headers } });

const makeBase = () => {
  let n = 0;
  const base = vi.fn(async (input, init) => {
    n += 1;
    if ((init?.method || 'GET') === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': `*/${n}` } });
    return json({ n });
  });
  return base;
};
const body = async (res) => (await res.json()).n;

describe('requestBudget fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    logError.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not touch non-REST requests (auth, storage, functions)', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    await f('https://x.supabase.co/auth/v1/user');
    await f('https://x.supabase.co/auth/v1/user');
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('N concurrent identical reads -> 1 request, every caller gets its own readable body', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    const results = await Promise.all(Array.from({ length: 5 }, () => f(`${BASE}/orders?select=id`)));
    expect(base).toHaveBeenCalledTimes(1);
    for (const res of results) expect(await body(res)).toBe(1);
  });

  it('does not merge reads that differ in URL, Range or user', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    await Promise.all([
      f(`${BASE}/orders?select=id`),
      f(`${BASE}/orders?select=id,status`),
      f(`${BASE}/orders?select=id`, { headers: { Range: '0-9' } }),
      f(`${BASE}/orders?select=id`, { headers: { Authorization: 'Bearer other' } })
    ]);
    expect(base).toHaveBeenCalledTimes(4);
  });

  it('caches the display rate reads (all active rates in one read, currencies) for the TTL, then refetches', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base, { cacheTtlMs: 300_000 });
    const url = `${BASE}/exchange_rates?select=from_currency_id%2Cto_currency_id%2Crate%2Ceffective_date&is_active=eq.true&order=effective_date.desc`;
    expect(await body(await f(url))).toBe(1);
    await vi.advanceTimersByTimeAsync(299_000);
    expect(await body(await f(url))).toBe(1);
    expect(base).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await body(await f(url))).toBe(2);
  });

  it('caches only the allow-listed display selects: other reads of the same tables stay live', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    await f(`${BASE}/currencies?select=*`);
    await f(`${BASE}/currencies?select=*`);
    await f(`${BASE}/currencies?select=id%2Ccode&code=in.%28USD%2CCUP%29`);
    await f(`${BASE}/currencies?select=id%2Ccode&code=in.%28USD%2CCUP%29`);
    expect(base).toHaveBeenCalledTimes(4);
  });

  it('requests with an abort signal never share a request (one caller aborting must not abort the others)', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    const url = `${BASE}/orders?select=id`;
    await Promise.all([f(url, { signal: new AbortController().signal }), f(url, { signal: new AbortController().signal })]);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never caches other tables between sequential reads (counters stay live)', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    await f(`${BASE}/remittances?select=id`, { method: 'HEAD' });
    await f(`${BASE}/remittances?select=id`, { method: 'HEAD' });
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('rate cache survives a reload through localStorage and a write anywhere clears it (own action never stale)', async () => {
    const base = makeBase();
    const url = `${BASE}/currencies?select=id%2Ccode%2Csymbol%2Cis_base`;
    await createRequestBudgetFetch(base)(url);
    const reloaded = createRequestBudgetFetch(base);
    expect(await body(await reloaded(url))).toBe(1);
    expect(base).toHaveBeenCalledTimes(1);

    await reloaded(`${BASE}/exchange_rates?id=eq.1`, { method: 'PATCH', body: '{}' });
    expect(localStorage.getItem(API_CACHE_STORAGE_KEY)).toBeNull();
    expect(await body(await reloaded(url))).toBe(3);
  });

  it('another tab writing (storage event) drops this tab\'s cache', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    const url = `${BASE}/currencies?select=id%2Ccode%2Csymbol%2Cis_base`;
    await f(url);
    window.dispatchEvent(new StorageEvent('storage', { key: API_CACHE_STORAGE_KEY, newValue: null }));
    await f(url);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('a read in flight while a write lands is not cached (it may predate the write)', async () => {
    let release;
    const base = vi.fn((input, init) => {
      if ((init?.method || 'GET') === 'GET' && !release) return new Promise((r) => { release = () => r(json({ n: 'old' })); });
      return Promise.resolve(json({ n: 'new' }));
    });
    const f = createRequestBudgetFetch(base);
    const url = `${BASE}/currencies?select=id%2Ccode%2Csymbol%2Cis_base`;
    const pending = f(url);
    await f(`${BASE}/currencies?id=eq.1`, { method: 'PATCH', body: '{}' });
    release();
    expect(await body(await pending)).toBe('old');
    expect(await body(await f(url))).toBe('new');
  });

  it('announces writes (POST/PATCH/DELETE and mutating RPCs), not reads nor read-only RPCs', async () => {
    const base = makeBase();
    const f = createRequestBudgetFetch(base);
    const seen = vi.fn();
    const off = subscribeApiWrites(seen);
    await f(`${BASE}/orders?select=id`);
    await f(`${BASE}/rpc/get_pending_orders_count`, { method: 'POST', body: '{}' });
    await f(`${BASE}/rpc/admin_refund_counts`, { method: 'POST', body: '{}' });
    expect(seen).not.toHaveBeenCalled();
    await f(`${BASE}/orders?id=eq.1`, { method: 'PATCH', body: '{}' });
    await f(`${BASE}/rpc/admin_resolve_refund`, { method: 'POST', body: '{}' });
    expect(seen.mock.calls.map(([path]) => path)).toEqual(['/rest/v1/orders', '/rest/v1/rpc/admin_resolve_refund']);
    off();
  });

  describe('budget guardrail', () => {
    it('over 30 identical reads/min: serves the last answer from memory, logs once, recovers after the window', async () => {
      const base = makeBase();
      const f = createRequestBudgetFetch(base, { maxPerMinute: 30 });
      const url = `${BASE}/rpc/get_pending_orders_count`;
      for (let i = 0; i < 30; i += 1) await f(url, { method: 'POST', body: '{}' });
      expect(base).toHaveBeenCalledTimes(30);
      for (let i = 0; i < 20; i += 1) expect(await body(await f(url, { method: 'POST', body: '{}' }))).toBe(30);
      expect(base).toHaveBeenCalledTimes(30);
      expect(logError).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await body(await f(url, { method: 'POST', body: '{}' }))).toBe(31);
    });

    it('never drops writes, even far over the threshold', async () => {
      const base = makeBase();
      const f = createRequestBudgetFetch(base, { maxPerMinute: 2 });
      for (let i = 0; i < 10; i += 1) await f(`${BASE}/site_visits`, { method: 'POST', body: '{}' });
      expect(base).toHaveBeenCalledTimes(10);
    });

    it('after an own write the next read goes to the network even over budget (never stale after an action)', async () => {
      const base = makeBase();
      const f = createRequestBudgetFetch(base, { maxPerMinute: 2 });
      const url = `${BASE}/orders?select=id`;
      for (let i = 0; i < 4; i += 1) await f(url);
      expect(base).toHaveBeenCalledTimes(2);
      await f(`${BASE}/orders?id=eq.1`, { method: 'PATCH', body: '{}' });
      expect(await body(await f(url))).toBe(4);
    });

    it('with no identical earlier answer the read goes through (never serves another query\'s body)', async () => {
      const base = makeBase();
      const f = createRequestBudgetFetch(base, { maxPerMinute: 2 });
      for (let i = 0; i < 5; i += 1) await f(`${BASE}/orders?id=eq.${i}`);
      expect(base).toHaveBeenCalledTimes(5);
    });

    it('can be switched off by flag: every request passes through untouched', async () => {
      const base = makeBase();
      const f = createRequestBudgetFetch(base, { enabled: false });
      await Promise.all([f(`${BASE}/currencies?select=id%2Ccode%2Csymbol%2Cis_base`), f(`${BASE}/currencies?select=id%2Ccode%2Csymbol%2Cis_base`)]);
      expect(base).toHaveBeenCalledTimes(2);
    });
  });
});
