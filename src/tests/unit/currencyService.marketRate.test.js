/**
 * market_rate (internal reference, super-admin only in the UI) per exchange-rate pair.
 * Optional everywhere: when not provided it is never written (the DB trigger fills it on insert and an update
 * must never overwrite it); when provided it must be a positive finite number, the inverse row stores 1 / market.
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

  it('stores market_rate on the direct row and 1/market on the inverse', async () => {
    db.responses = [ok([]), ok({ id: 'd' }), ok({ id: 'i' })];
    await saveExchangeRatePair({ ...base, marketRate: '900' });
    expect(upserts()[0].values.market_rate).toBe(900);
    expect(upserts()[1].values.market_rate).toBeCloseTo(1 / 900, 12);
  });

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

  it('writes market_rate to the direct row and 1/market to the inverse when provided', async () => {
    script();
    await updateExchangeRatePair(USD, CUP, '915', '2026-11-04', { marketRate: '900' });
    expect(updates()[0].values).toMatchObject({ rate: 915, market_rate: 900 });
    expect(updates()[1].values.market_rate).toBeCloseTo(1 / 900, 12);
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
