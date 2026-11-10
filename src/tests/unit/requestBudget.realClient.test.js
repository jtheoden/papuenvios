import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Real supabase client + real services over a scripted network. Each test re-imports the modules so it starts with
// an empty in-memory cache (what a page reload does); localStorage is kept or cleared on purpose.
const net = { rate: 400, orders: 'v1', pendingOrders: null, pending: 2, latencyMs: 0, hangOnce: null, calls: [] };

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const scriptedFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const path = url.pathname;
  net.calls.push(`${method} ${path}${url.search}`);
  if (net.hangOnce === path) {
    // A request that never answers (like a stalled mobile connection); only an abort settles it, as with real fetch.
    net.hangOnce = null;
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }
  const accept = new Headers(init.headers).get('accept') || '';
  const one = (rows) => (accept.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
  if (path === '/rest/v1/rpc/get_pending_orders_count') return json(net.pending);
  if (method === 'HEAD' && path === '/rest/v1/remittances') {
    if (net.latencyMs) await new Promise((resolve) => setTimeout(resolve, net.latencyMs));
    return new Response(null, { status: 200, headers: { 'Content-Range': `*/${net.pending}` } });
  }
  if (method !== 'GET' && method !== 'HEAD') return json([]);
  if (path === '/rest/v1/currencies') {
    return json([{ id: 'usd', code: 'USD', symbol: '$', is_base: true }, { id: 'cup', code: 'CUP', symbol: '$', is_base: false }]);
  }
  if (path === '/rest/v1/exchange_rates') {
    const from = url.searchParams.get('from_currency_id');
    const fromCode = url.searchParams.get('from_currency.code');
    const usdToCup = { from_currency_id: 'usd', to_currency_id: 'cup', rate: net.rate, effective_date: '2026-11-01', updated_at: null };
    if (from && from !== 'eq.usd') return json(one([]));
    if (fromCode && fromCode !== 'eq.USD') return json(one([]));
    return json(one([usdToCup]));
  }
  if (path === '/rest/v1/orders') {
    if (net.pendingOrders) return net.pendingOrders;
    return json([{ id: 1, v: net.orders }]);
  }
  return json([]);
};

const load = async () => {
  vi.resetModules();
  const svc = await import('@/lib/currencyService');
  const { supabase } = await import('@/lib/supabase');
  return { svc, supabase };
};

describe('requestBudget with the real Supabase client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubGlobal('fetch', scriptedFetch);
    localStorage.clear();
    net.rate = 400;
    net.orders = 'v1';
    net.pendingOrders = null;
    net.pending = 2;
    net.latencyMs = 0;
    net.hangOnce = null;
    net.calls = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('reads that price an operation are never served from a cache', () => {
    it('getExchangeRate sees a rate changed on the server between two calls (400 -> 500)', async () => {
      const { svc } = await load();
      await svc.getConversionRate('usd', 'cup'); // the display read is cached meanwhile
      expect(await svc.getExchangeRate('USD', 'CUP')).toBe(400);
      net.rate = 500;
      expect(await svc.getExchangeRate('USD', 'CUP')).toBe(500);
      expect(await svc.convertCurrency(2, 'USD', 'CUP')).toBe(1000);
    });

    it('...also after a reload with the localStorage cache populated', async () => {
      const first = await load();
      await first.svc.getConversionRate('usd', 'cup');
      await first.svc.getCurrenciesWithRates();
      expect(await first.svc.getExchangeRate('USD', 'CUP')).toBe(400);
      expect(localStorage.length).toBeGreaterThan(0);
      net.rate = 500;
      const reloaded = await load();
      expect(await reloaded.svc.getExchangeRate('USD', 'CUP')).toBe(500);
    });

    it('getActiveRate (payment FX card) is always read from the server', async () => {
      const { svc } = await load();
      expect((await svc.getActiveRate('USD', 'CUP')).rate).toBe(400);
      net.rate = 500;
      expect((await svc.getActiveRate('USD', 'CUP')).rate).toBe(500);
    });
  });

  it('a read issued after a write never joins a request started before it', async () => {
    const { supabase } = await load();
    let release;
    net.pendingOrders = new Promise((resolve) => { release = () => resolve(json([{ id: 1, v: 'before' }])); });
    const earlyResult = supabase.from('orders').select('id, v').then((r) => r);
    await vi.waitFor(() => expect(net.calls.some((c) => c.startsWith('GET /rest/v1/orders'))).toBe(true));
    await supabase.from('orders').update({ v: 'after' }).eq('id', 1);
    net.pendingOrders = null;
    net.orders = 'after';
    const lateResult = supabase.from('orders').select('id, v').then((r) => r); // starts while the early read is pending
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    expect((await earlyResult).data[0].v).toBe('before');
    expect((await lateResult).data[0].v).toBe('after');
  });

  // Same shape as the admin badge count (getPendingRemittancesCount): select id + status in (...)
  const countRemittances = (supabase, status = 'payment_proof_uploaded') =>
    supabase.from('remittances').select('id', { count: 'exact', head: true }).in('status', [status]).then((r) => r.count);
  const pendingOrders = (supabase) => supabase.rpc('get_pending_orders_count').then((r) => r.data);
  const network = (prefix) => net.calls.filter((c) => c.startsWith(prefix)).length;

  it('the guardrail never serves an answer older than its window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { supabase } = await load();
    expect(await countRemittances(supabase)).toBe(2);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    for (let i = 0; i < 40; i += 1) await countRemittances(supabase, `s${i}`);
    net.pending = 5;
    expect(await countRemittances(supabase)).toBe(5);
  });

  it('answers served by the guardrail do not count: it recovers as soon as the real requests leave the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { supabase } = await load();
    for (let i = 0; i < 30; i += 1) await pendingOrders(supabase);
    for (let i = 0; i < 50; i += 1) {
      vi.setSystemTime(Date.now() + 1_000); // a runaway loop keeps asking every second
      await pendingOrders(supabase);
    }
    const before = network('POST /rest/v1/rpc/get_pending_orders_count');
    expect(before).toBe(30);
    net.pending = 9;
    vi.setSystemTime(Date.now() + 11_000); // > 60 s since the last real request
    expect(await pendingOrders(supabase)).toBe(9);
    expect(network('POST /rest/v1/rpc/get_pending_orders_count')).toBe(before + 1);
  });

  it('R8: a hung read does not freeze the next ones; the hung request times out and settles', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { svc } = await load();
    net.hangOnce = '/rest/v1/exchange_rates';
    const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));
    const first = settle(svc.getConversionRate('usd', 'cup'));
    await vi.advanceTimersByTimeAsync(20);
    const joined = settle(svc.getConversionRate('usd', 'cup')); // 20 ms later: legitimately shares the request
    expect(network('GET /rest/v1/exchange_rates')).toBe(1);
    await vi.advanceTimersByTimeAsync(16_000);
    // The shared request is too old to join: the next read reaches the network and gets the rate.
    expect(await svc.getConversionRate('usd', 'cup')).toBe(400);
    expect(network('GET /rest/v1/exchange_rates')).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await first).error).toBeTruthy();
    expect((await joined).error).toBeTruthy();
  });

  it('the guardrail matches exact parameters: another HEAD count on the same table always reaches the network', async () => {
    const { supabase } = await load();
    // getInteractionCount shape: user_id + status filters, not the badge count
    const interactions = () => supabase.from('remittances').select('id', { count: 'exact', head: true })
      .eq('user_id', 'u1').eq('status', 'completed').then((r) => r.count);
    for (let i = 0; i < 40; i += 1) await interactions();
    net.pending = 6;
    expect(await interactions()).toBe(6);
    expect(network('HEAD /rest/v1/remittances')).toBe(41);
  });

  it('a stored answer dated in the future (clock moved back) is never served', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { svc } = await load();
    expect(await svc.getConversionRate('usd', 'cup')).toBe(400);
    vi.setSystemTime(Date.now() - 60 * 60_000);
    net.rate = 500;
    expect(await svc.getConversionRate('usd', 'cup')).toBe(500);
  });

  it('a realtime change makes the next identical read go to the network even over budget', async () => {
    const { supabase } = await load();
    const { noteRemoteChange } = await import('@/lib/requestBudget');
    for (let i = 0; i < 35; i += 1) await pendingOrders(supabase);
    net.pending = 7;
    noteRemoteChange();
    expect(await pendingOrders(supabase)).toBe(7);
  });

  describe('the guardrail never touches money reads, and only real requests count', () => {
    it('reads joined in flight do not count: after 40 parallel identical counts the next one still goes to the network', async () => {
      const { supabase } = await load();
      net.latencyMs = 20; // a real network: the 40 calls overlap and join
      await Promise.all(Array.from({ length: 40 }, () => countRemittances(supabase)));
      expect(network('HEAD /rest/v1/remittances')).toBeLessThan(30);
      net.pending = 3;
      expect(await countRemittances(supabase)).toBe(3);
    });

    it('40 parallel getExchangeRate, then a rate change: getExchangeRate sees the new rate', async () => {
      const { svc } = await load();
      await Promise.all(Array.from({ length: 40 }, () => svc.getExchangeRate('USD', 'CUP')));
      net.rate = 500;
      expect(await svc.getExchangeRate('USD', 'CUP')).toBe(500);
    });

    it('CartPage pattern: 4 parallel convertCurrency per totals change, 8 changes, then a rate change', async () => {
      const { svc } = await load();
      for (let change = 0; change < 8; change += 1) {
        await Promise.all([1, 2, 3, 4].map((n) => svc.convertCurrency(n + change, 'USD', 'CUP')));
      }
      net.rate = 500;
      expect(await svc.convertCurrency(1, 'USD', 'CUP')).toBe(500);
    });

    it('getActiveRatesMap x30 does not starve getExchangeRate of fresh data', async () => {
      const { svc } = await load();
      for (let i = 0; i < 30; i += 1) await svc.getActiveRatesMap();
      net.rate = 500;
      expect(await svc.getExchangeRate('USD', 'CUP')).toBe(500);
      expect((await svc.getActiveRatesMap())['usd-cup']).toBe(500);
    });

    it('combined: counters over budget are served from memory while money reads joined in flight stay live', async () => {
      const { svc, supabase } = await load();
      for (let i = 0; i < 31; i += 1) await pendingOrders(supabase);
      net.pending = 8;
      expect(await pendingOrders(supabase)).toBe(2); // guardrail: counter served from its recent answer
      await Promise.all(Array.from({ length: 35 }, () => svc.getExchangeRate('USD', 'CUP')));
      net.rate = 500;
      await Promise.all(Array.from({ length: 35 }, () => svc.getExchangeRate('USD', 'CUP')));
      expect(await svc.getExchangeRate('USD', 'CUP')).toBe(500);
    });
  });

  describe('reads that set prices use the live path, the cache only feeds the display', () => {
    it('getLiveConversionRate sees a change the cached display read does not see yet', async () => {
      const { svc } = await load();
      expect(await svc.getConversionRate('usd', 'cup')).toBe(400);
      net.rate = 500;
      expect(await svc.getConversionRate('usd', 'cup')).toBe(400); // display: cached for a short TTL
      expect(await svc.getLiveConversionRate('usd', 'cup')).toBe(500);
      expect(await svc.getLiveConversionRate('cup', 'usd')).toBeCloseTo(1 / 500);
    });

    it('invalidateRateCaches drops the cached display read and tells the rate caches', async () => {
      const { svc } = await load();
      await svc.getConversionRate('usd', 'cup');
      net.rate = 500;
      const changed = vi.fn();
      svc.subscribeRatesChanged(changed);
      svc.invalidateRateCaches();
      expect(changed).toHaveBeenCalled();
      expect(await svc.getConversionRate('usd', 'cup')).toBe(500);
    });
  });
});
