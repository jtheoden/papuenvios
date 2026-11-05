import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// Real supabase client + real currencyService over a mocked network: proves that every rate read goes through the
// requestBudget cache and that a save invalidates it.
const RATES = [
  { from_currency_id: 'usd', to_currency_id: 'cup', rate: '400', effective_date: '2026-11-01' },
  { from_currency_id: 'eur', to_currency_id: 'usd', rate: '1.1', effective_date: '2026-11-01' }
];

let fetchMock;
let svc;
let rateRequests;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  fetchMock = vi.fn(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method || 'GET';
    if (url.pathname.startsWith('/rest/v1/exchange_rates')) {
      if (method === 'GET') {
        rateRequests += 1;
        return new Response(JSON.stringify(RATES), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  svc = await import('@/lib/currencyService');
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('exchange-rate reads share one cached request', () => {
  beforeEach(() => {
    rateRequests = 0;
  });

  it('N concurrent conversions of different pairs -> 1 request, and later ones are served from the cache', async () => {
    const rates = await Promise.all([
      svc.getConversionRate('usd', 'cup'),
      svc.getConversionRate('cup', 'usd'),
      svc.getConversionRate('eur', 'usd'),
      svc.getConversionRate('usd', 'eur'),
      svc.getConversionRate('usd', 'cup')
    ]);
    expect(rates[0]).toBe(400);
    expect(rates[1]).toBeCloseTo(1 / 400);
    expect(rates[2]).toBe(1.1);
    expect(rates[3]).toBeCloseTo(1 / 1.1);
    expect(rateRequests).toBe(1);

    await svc.getConversionRate('usd', 'cup');
    expect(rateRequests).toBe(1);
  });

  it('saving a rate invalidates the cache (the next read goes to the network) and tells the rate caches', async () => {
    await svc.getConversionRate('usd', 'cup');
    const before = rateRequests;
    const changed = vi.fn();
    const off = svc.subscribeRatesChanged(changed);

    const { supabase } = await import('@/lib/supabase');
    // The Settings save path writes the table directly (not through currencyService)
    await supabase.from('exchange_rates').update({ is_active: false }).eq('id', 'r1');

    expect(changed).toHaveBeenCalled();
    await svc.getConversionRate('usd', 'cup');
    expect(rateRequests).toBe(before + 1);
    off();
  });
});
