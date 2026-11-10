/**
 * market_rate (internal reference, super-admin only in the UI) per exchange-rate pair.
 * Optional everywhere: when not provided it is never written (the DB trigger fills it on insert and an update
 * must never overwrite it); when provided it must be a positive finite number.
 * The DB enforces rate >= market_rate on EVERY row (constraint rate_higher_than_market): the operative reference
 * (market_rate) can never exceed the rate users see. The pair writes the inverse row with its own rate as reference,
 * otherwise 1/market would exceed 1/rate for any rate above the market and the inverse leg would always be rejected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ ops: [], responses: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = () => {
    const chain = { op: 'select', filters: [] };
    const record = (name) => (...args) => { chain.filters.push([name, ...args]); return chain; };
    chain.select = (cols) => { chain.cols = cols; return chain; };
    chain.upsert = (values) => { chain.op = 'upsert'; chain.values = values; return chain; };
    chain.update = (values) => { chain.op = 'update'; chain.values = values; return chain; };
    chain.delete = () => { chain.op = 'delete'; return chain; };
    chain.single = () => chain;
    chain.eq = record('eq');
    chain.order = record('order');
    chain.then = (resolve, reject) => {
      db.ops.push({ op: chain.op, values: chain.values, filters: chain.filters, cols: chain.cols });
      const result = db.responses.shift() ?? { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: () => makeChain() } };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { getAllExchangeRates, saveExchangeRatePair, updateExchangeRatePair } from '@/lib/currencyService';

const ok = (data) => ({ data, error: null });
// numeric(14,6): both columns round the same way
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const violatesDbCheck = (values) => values.market_rate !== undefined && round6(values.rate) < round6(values.market_rate);
const USD = '11111111-1111-4111-8111-111111111111';
const CUP = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { db.ops = []; db.responses = []; });

describe('getAllExchangeRates', () => {
  it('selects market_rate explicitly', async () => {
    db.responses = [ok([])];
    await getAllExchangeRates();
    expect(db.ops[0].cols).toMatch(/\bmarket_rate\b/);
  });
});

describe('saveExchangeRatePair market rate', () => {
  const base = { fromCurrencyId: USD, toCurrencyId: CUP, rate: '915', effectiveDate: '2026-11-04' };
  const upserts = () => db.ops.filter((o) => o.op === 'upsert');

  it('omits market_rate from both upserts when not provided', async () => {
    db.responses = [ok([]), ok({ id: 'd' }), ok({ id: 'i' })];
    await saveExchangeRatePair(base);
    upserts().forEach((u) => expect(u.values).not.toHaveProperty('market_rate'));
  });

  it('stores market_rate on the direct row and the inverse rate itself on the inverse row', async () => {
    db.responses = [ok([]), ok({ id: 'd' }), ok({ id: 'i' })];
    await saveExchangeRatePair({ ...base, marketRate: '900' });
    expect(upserts()[0].values.market_rate).toBe(900);
    expect(upserts()[1].values.market_rate).toBe(upserts()[1].values.rate);
  });

  it.each([['915', '900'], ['910', '900'], ['900', '900'], ['900.05', '900'], ['1000', '860']])(
    'rate %s with market %s: neither row violates rate >= market_rate',
    async (rate, market) => {
      db.responses = [ok([]), ok({ id: 'd' }), ok({ id: 'i' })];
      await saveExchangeRatePair({ ...base, rate, marketRate: market });
      expect(upserts()).toHaveLength(2);
      upserts().forEach((u) => expect(violatesDbCheck(u.values)).toBe(false));
    }
  );

  it.each([['860', '880'], ['899.99', '900']])(
    'rate %s below the market %s is refused before any write (the rate users see cannot be below the operative one)',
    async (rate, market) => {
      await expect(saveExchangeRatePair({ ...base, rate, marketRate: market })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(db.ops).toHaveLength(0);
    }
  );

  it.each([['0'], ['-5'], ['abc'], [Infinity]])('rejects an invalid market rate (%s) before any write', async (bad) => {
    await expect(saveExchangeRatePair({ ...base, marketRate: bad })).rejects.toBeDefined();
    expect(db.ops).toHaveLength(0);
  });

  it.each([[''], [null], [undefined]])('treats %s as not provided', async (empty) => {
    db.responses = [ok([]), ok({ id: 'd' }), ok({ id: 'i' })];
    await saveExchangeRatePair({ ...base, marketRate: empty });
    upserts().forEach((u) => expect(u.values).not.toHaveProperty('market_rate'));
  });
});

describe('updateExchangeRatePair market rate', () => {
  const updates = () => db.ops.filter((o) => o.op === 'update');
  const script = () => {
    db.responses = [ok([{ id: 'd', rate: 900, effective_date: '2026-11-01' }]), ok([{ id: 'd' }]), ok([{ id: 'i' }])];
  };

  it('never touches market_rate when not provided', async () => {
    script();
    await updateExchangeRatePair(USD, CUP, '915', '2026-11-04');
    updates().forEach((u) => expect(u.values).not.toHaveProperty('market_rate'));
  });

  it('writes market_rate to the direct row and the inverse rate itself to the inverse row when provided', async () => {
    script();
    await updateExchangeRatePair(USD, CUP, '915', '2026-11-04', { marketRate: '900' });
    expect(updates()[0].values).toMatchObject({ rate: 915, market_rate: 900 });
    expect(updates()[1].values.market_rate).toBe(updates()[1].values.rate);
  });

  it.each([['915', '900'], ['910', '900'], ['900', '900'], ['1000', '860']])(
    'rate %s with market %s: neither row violates rate >= market_rate',
    async (rate, market) => {
      script();
      await updateExchangeRatePair(USD, CUP, rate, '2026-11-04', { marketRate: market });
      expect(updates()).toHaveLength(2);
      updates().forEach((u) => expect(violatesDbCheck(u.values)).toBe(false));
    }
  );

  it.each([['860', '880'], ['899.99', '900']])('rate %s below the market %s is refused before any write', async (rate, market) => {
    await expect(updateExchangeRatePair(USD, CUP, rate, '2026-11-04', { marketRate: market })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.ops).toHaveLength(0);
  });

  it.each([['0'], ['-1'], ['x'], [Infinity]])('rejects an invalid market rate (%s) before any write', async (bad) => {
    await expect(updateExchangeRatePair(USD, CUP, '915', '2026-11-04', { marketRate: bad })).rejects.toBeDefined();
    expect(db.ops).toHaveLength(0);
  });

  it.each([[''], [null], [undefined]])('treats %s as not provided', async (empty) => {
    script();
    await updateExchangeRatePair(USD, CUP, '915', '2026-11-04', { marketRate: empty });
    updates().forEach((u) => expect(u.values).not.toHaveProperty('market_rate'));
  });
});
