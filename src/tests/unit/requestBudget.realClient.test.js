import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Real supabase client + real services over a scripted network. Each test re-imports the modules so it starts with
// an empty in-memory cache (what a page reload does); localStorage is kept or cleared on purpose.
const net = { rate: 400, orders: 'v1', pendingOrders: null, calls: [] };

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const scriptedFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const path = url.pathname;
  net.calls.push(`${method} ${path}${url.search}`);
  const accept = new Headers(init.headers).get('accept') || '';
  const one = (rows) => (accept.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
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
});
